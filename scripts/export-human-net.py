"""KataGo's human-style network (PyTorch checkpoint) -> ONNX, one graph for any board size.

Usage: python3 scripts/export-human-net.py <KataGo checkout> b18c384nbt-humanv0.ckpt b18c384nbt-humanv0.onnx
Needs torch, onnx and numpy, and a clone of https://github.com/lightvector/KataGo for its model code. The
checkpoint is b18c384nbt-humanv0.ckpt from https://github.com/lightvector/KataGo/releases/tag/v1.15.0;
newer KataGo code first asks to run python/migrate_defaultdict_to_dict.py on it. See modules/go-net/README.md.

Inputs:  bin_input [1,22,H,W], global_input [1,19], input_meta [1,192] (the profile, src/go/human.ts)
Outputs: as scripts/convert-net.py: policy [1,1,H,W] logits, pass [1,1] logit, value [1,3],
         score [1,1] (score mean / 20), ownership [1,1,H,W]
The weights are stored as float16 and widened when the network loads, which halves the file.
"""
import sys
import numpy as np
import onnx
import torch
from onnx import helper, numpy_helper, TensorProto

kata, src, dst = sys.argv[1:4]
sys.path.insert(0, f'{kata}/python')
from katago.train.load_model import load_model  # noqa: E402

model, _, _ = load_model(src, use_swa=False, device='cpu', pos_len=19, verbose=False)
model.eval()


class Outputs(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, bin_input, global_input, input_meta):
        policy, value, misc, _, ownership = self.m(bin_input, global_input, input_meta=input_meta)[0][:5]
        h, w = bin_input.shape[2], bin_input.shape[3]
        main = policy[:, 0, :]
        score = misc[:, 0:1] * (self.m.scoremean_multiplier / 20.0)
        return main[:, :-1].reshape(1, 1, h, w), main[:, -1:], value, score, ownership


b = torch.zeros(1, 22, 19, 19)
b[:, 0] = 1
with torch.no_grad():
    torch.onnx.export(Outputs(model), (b, torch.zeros(1, 19), torch.zeros(1, 192)), dst, dynamo=False, opset_version=17,
                      input_names=['bin_input', 'global_input', 'input_meta'],
                      output_names=['policy', 'pass', 'value', 'score', 'ownership'],
                      dynamic_axes={'bin_input': {2: 'H', 3: 'W'}, 'policy': {2: 'H', 3: 'W'}, 'ownership': {2: 'H', 3: 'W'}})

net = onnx.load(dst)
g = net.graph
casts = []
for init in list(g.initializer):
    a = numpy_helper.to_array(init)
    if a.dtype == np.float32 and a.size >= 1024:
        g.initializer.remove(init)
        g.initializer.append(numpy_helper.from_array(a.astype(np.float16), init.name + '_h'))
        casts.append(helper.make_node('Cast', [init.name + '_h'], [init.name], to=TensorProto.FLOAT))
for c in reversed(casts):
    g.node.insert(0, c)
onnx.save(net, dst)

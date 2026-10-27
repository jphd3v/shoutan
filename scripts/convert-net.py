"""KataGo network (text format, model version 8) -> ONNX, one graph for any board size.

Usage: python3 scripts/convert-net.py <name>.txt.gz <name>.onnx   (needs numpy and onnx)
The networks come from https://katagotraining.org/networks/; see modules/go-net/README.md.

Inputs:  bin_input [1,22,H,W] (NCHW), global_input [1,19]
Outputs: policy [1,1,H,W] logits, pass [1,1] logit, value [1,3] (win, loss, noresult logits),
         score [1,K], ownership [1,1,H,W]
"""
import gzip, sys
import numpy as np
import onnx
from onnx import helper, TensorProto, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
tokens = gzip.open(src, 'rt').read().split()
pos = 0


def tok():
    global pos
    pos += 1
    return tokens[pos - 1]


def ints(k):
    return [int(tok()) for _ in range(k)]


def floats(k):
    global pos
    a = np.array(tokens[pos:pos + k], dtype=np.float32)
    pos += k
    return a


nodes, inits = [], []
uid = [0]


def name(p):
    uid[0] += 1
    return f'{p}_{uid[0]}'


def const(arr, p='c'):
    n = name(p)
    inits.append(numpy_helper.from_array(np.asarray(arr, dtype=np.float32), n))
    return n


def node(op, ins, **kw):
    out = name(op)
    nodes.append(helper.make_node(op, ins, [out], **kw))
    return out


def conv(x):
    nm = tok()
    ky, kx, ic, oc, dy, dx = ints(6)
    w = floats(ky * kx * ic * oc).reshape(ky, kx, ic, oc).transpose(3, 2, 0, 1)
    return node('Conv', [x, const(w, nm + '_w')], pads=[ky // 2, kx // 2, ky // 2, kx // 2], dilations=[dy, dx])


def bn(x):
    nm = tok()
    c = int(tok())
    eps = float(tok())
    has_scale, has_bias = ints(2)
    mean, var = floats(c), floats(c)
    scale = floats(c) if has_scale else np.ones(c, np.float32)
    bias = floats(c) if has_bias else np.zeros(c, np.float32)
    ms = scale / np.sqrt(var + eps)
    mb = bias - ms * mean
    return node('Add', [node('Mul', [x, const(ms.reshape(1, c, 1, 1))]), const(mb.reshape(1, c, 1, 1))])


def act(x):
    tok()  # name; version 8 is always ReLU
    return node('Relu', [x])


def matmul(x):
    tok()
    ic, oc = ints(2)
    return node('MatMul', [x, const(floats(ic * oc).reshape(ic, oc))])


def matbias(x):
    tok()
    c = int(tok())
    return node('Add', [x, const(floats(c).reshape(1, c))])


def add_nc_bias(x, b):
    return node('Add', [x, node('Unsqueeze', [b, axes23])])


def gpool(x, value_head=False):
    mean = node('ReduceMean', [x], axes=[2, 3], keepdims=0)
    m1 = node('Mul', [mean, size_term])
    if value_head:
        third = node('Mul', [mean, size_term2])
    else:
        third = node('ReduceMax', [x], axes=[2, 3], keepdims=0)
    return node('Concat', [mean, m1, third], axis=1)


# Header
model_name = tok()
version = int(tok())
assert version == 8, f'only version 8 supported, got {version}'
n_in, n_gin = ints(2)

graph_inputs = [
    helper.make_tensor_value_info('bin_input', TensorProto.FLOAT, [1, n_in, 'H', 'W']),
    helper.make_tensor_value_info('global_input', TensorProto.FLOAT, [1, n_gin]),
]
axes23 = name('axes')
inits.append(numpy_helper.from_array(np.array([2, 3], dtype=np.int64), axes23))

# KataGo's pooling scales with the board: (sqrt(H*W) - 14) * 0.1, and for the value head (...)^2 * 0.01 - 0.1.
shape = node('Shape', ['bin_input'])
hw = node('ReduceProd', [node('Slice', [shape, const_i := name('i'), const_j := name('j')])], keepdims=1)
inits.append(numpy_helper.from_array(np.array([2], dtype=np.int64), const_i))
inits.append(numpy_helper.from_array(np.array([4], dtype=np.int64), const_j))
sq = node('Sqrt', [node('Cast', [hw], to=TensorProto.FLOAT)])
d = node('Sub', [sq, const(np.array([14.0]))])
size_term = node('Mul', [d, const(np.array([0.1]))])
size_term2 = node('Sub', [node('Mul', [node('Mul', [d, d]), const(np.array([0.01]))]), const(np.array([0.1]))])

# Trunk
tok()  # 'trunk'
n_blocks, trunk_c, mid_c, reg_c, dil_c, gpool_c = ints(6)
x = conv('bin_input')
x = add_nc_bias(x, matmul('global_input'))
for _ in range(n_blocks):
    kind = tok()
    tok()  # block name
    if kind == 'ordinary_block':
        h = act(bn(x))
        h = conv(h)
        h = act(bn(h))
        h = conv(h)
    elif kind == 'gpool_block':
        h0 = act(bn(x))
        reg = conv(h0)
        g = conv(h0)
        g = act(bn(g))
        reg = add_nc_bias(reg, matmul(gpool(g)))
        h = act(bn(reg))
        h = conv(h)
    else:
        raise ValueError(kind)
    x = node('Add', [x, h])
trunk = act(bn(x))

# Policy head
tok()
p1 = conv(trunk)
g1 = conv(trunk)
g1 = act(bn(g1))
g1c = gpool(g1)
p1 = add_nc_bias(p1, matmul(g1c))
p1 = act(bn(p1))
policy = conv(p1)
pass_ = matmul(g1c)

# Value head
tok()
v1 = act(bn(conv(trunk)))
vm = matmul(gpool(v1, value_head=True))
vm = matbias(vm)
v2 = act(vm)
value = matbias(matmul(v2))
score = matbias(matmul(v2))
ownership = conv(v1)
assert pos == len(tokens), f'{len(tokens) - pos} tokens left'

shapes = {'policy': [1, 1, 'H', 'W'], 'pass': [1, 1], 'value': [1, 3], 'score': [1, 'K'], 'ownership': [1, 1, 'H', 'W']}
outs = {'policy': policy, 'pass': pass_, 'value': value, 'score': score, 'ownership': ownership}
for k, v in outs.items():
    nodes.append(helper.make_node('Identity', [v], [k]))
graph = helper.make_graph(nodes, model_name, graph_inputs,
                          [helper.make_tensor_value_info(k, TensorProto.FLOAT, shapes[k]) for k in outs], inits)
m = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)])
m.ir_version = 8
onnx.checker.check_model(m)
onnx.save(m, dst)
print('saved', dst, 'blocks', n_blocks, 'channels', trunk_c)

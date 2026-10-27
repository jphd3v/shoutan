import { eslintCompatPlugin } from "@oxlint/plugins";
import { noChainedTypeAssertionsRule } from "./src/rules/no-chained-type-assertions.ts";
import { noReduceAccumulatorCopyRule } from "./src/rules/no-reduce-accumulator-copy.ts";

export default eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-reduce-accumulator-copy": noReduceAccumulatorCopyRule,
  },
});

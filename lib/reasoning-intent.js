'use strict';

// Public progress summaries shared by all work modes.
const REASONING_INTENT_RULE = [
  '推理意图行（常驻规则）：每段思考结束后、执行动作或作答前，先单独输出一行以「意图：」开头的短句（≤30 字，用与用户相同的语言），说明这段思考的结论与下一步，例如「意图：已定位根因，开始做最小 diff」「意图：最小 diff 完成，现在跑测试」。',
  '只概括这一段已确认的情况与下一步目的，不复述内部推理；证据不足时保留不确定性，不得把准备执行写成已经完成。不要用工具名充数（「运行命令」「编辑文件」这类没有信息量）；一行一句，然后直接调用工具或给出正式回答。'
].join('\n');

module.exports = { REASONING_INTENT_RULE };

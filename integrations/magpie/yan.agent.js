// Magpie's embedded JS runtime: no Node APIs or external imports.
export const agent = {
  id: 'yan',
  name: 'Yan Agent',
  dir: '$APPDATA/yan-agent/YanData',
  config: '$APPDATA/yan-agent/YanData/magpie.json',
  format: 'json',
  model: 'model',
  notice: 'Yan 在新运行启动时读取 Magpie 配置；正在运行的任务保持原模型。断开后新运行恢复 Yan 原选择。'
};

export function connect({ gateway, models }) {
  return {
    version: 1,
    enabled: true,
    apiFormat: 'openai',
    baseUrl: gateway.v1,
    apiKey: gateway.key,
    models: (models ?? []).map(model => ({
      id: model.id,
      name: model.name ?? model.id,
      images: model.images === true,
      ...(model.context > 0 ? { context: model.context } : {}),
      ...(model.output > 0 ? { output: model.output } : {}),
      efforts: model.efforts ?? []
    }))
  };
}

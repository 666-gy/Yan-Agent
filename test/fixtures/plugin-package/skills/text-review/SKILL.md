---
name: text-review
description: 使用真实工具统计用户提供的文本。
---

1. 使用插件实际暴露的 text_stats 工具，原样传入待统计文本。
2. 如需报告格式，读取 resource:report-template。
3. characters 统计 Unicode 码点，words 统计以空白分隔的非空片段；不要把 words 解释为中文分词数量。
4. 保留工具定义的计数口径，给出简洁结果。

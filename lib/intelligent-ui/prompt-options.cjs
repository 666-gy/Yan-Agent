'use strict';
const buildPrompt = library => library.prompt({toolCalls:false,bindings:true,additionalRules:[
  'Return OpenUI Lang in Creator format=openui code. Root is Stack. Use the official component signatures below, local $state bindings and expressions. Never use the historical App/Budget/Choice catalog for a new program.',
  'Build the smallest useful visual explanation, comparison or working tool. Prefer clear containers and compact layouts; avoid repeating the host title or adding a completion toolbar. Label estimates and sources where they matter.',
  'All execution is local in a sandbox. Query and Mutation are unavailable. No action can send a chat message, open a URL, run a command, approve work or call a backend. Use local @Set/@Reset for interaction. Set render.handoff=true only when a user-selected result needs to be returned to the draft.',
  'Use researched data. Map uses static WGS84 [latitude, longitude] places and verified route geometry; declare resources.map and exact approved image URLs. Ordinary images are also restricted by resource grants. No network or media search inside the UI.',
  'Bind controls to $variables and derive text, tables or charts from the same variables. Controls must visibly change the relevant object/result. Avoid fixed heights and reflow at 320px. Use HTML only for custom interactions that the catalog cannot express.'
],examples:[
  'root = Stack([TextContent("调整数量，比较预算", "small"), FormControl("数量", Input("quantity", "", "number", null, $quantity)), TextContent("合计 ¥" + ($quantity * 280), "large-heavy")])\n$quantity = "3"',
  'root = Stack([Table([Col("方案", ["基础", "专业"]), Col("月费", [99, 299], "number")]), BarChart(["基础", "专业"], [Series("月费", [99, 299])])])'
]});
module.exports={buildPrompt};

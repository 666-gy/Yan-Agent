'use strict';
const budget='root = App([Note("交互测试：金额为示例估算，可调整数量。"), budget, choice])\nbudget = Budget("room", "房间焕新预算", "¥", 5000, [paint, light])\npaint = CostItem("paint", "墙面涂料", 280, 3, "桶")\nlight = CostItem("light", "灯具", 420, 2, "盏")\nchoice = Choice("finish", "墙面效果", [matte, gloss], "matte")\nmatte = Option("matte", "哑光", "柔和低反光")\ngloss = Option("gloss", "亮面", "明亮易清洁")';
const trip='root = App([trip])\ntrip = Trip("sf", [ferry, tower, park], [])\nferry = Place("ferry", "渡轮大厦", 37.7955, -122.3937, "旧金山滨水地标", "", "")\ntower = Place("tower", "科伊特塔", 37.8024, -122.4058, "电报山上的城市观景点", "", "")\npark = Place("park", "华盛顿广场", 37.8008, -122.4102, "北滩街区的公园", "", "")';
module.exports={budget,trip};

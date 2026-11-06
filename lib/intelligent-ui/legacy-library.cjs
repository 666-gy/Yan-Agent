'use strict';
const { z } = require('zod/v4');
const { defineComponent, createLibrary, createParser } = require('@openuidev/lang-core');
const text = z.string().max(1600), id = z.string().min(1).max(80), label = z.string().min(1).max(120), finite = z.number().finite();
const noteText = z.string().max(120).optional();
// Read-only compatibility catalog for saved App-root programs. New output uses the official catalog.
function makeLibrary(views = {}) {
 const define = (name, description, props) => defineComponent({name,description,props:z.object(props),component:views[name] || (()=>null)});
 const Note=define('Note','At most one per panel. A unit, source or method only - never interface instructions, UI behaviour or a disclaimer.',{text:z.string().max(200)});
 const Option=define('Option','Selectable item with stable id, label and brief detail.',{id,label,detail:text});
 const Choice=define('Choice','Select and retain an option; the selected detail changes with it.',{id,label,options:z.array(Option.ref).min(2).max(12),initial:z.string().max(80)});
 const CostItem=define('CostItem','Quantity times unit price. Use confirmed amounts or explicitly marked estimates.',{id,label,unitPrice:finite.min(0).max(1e9),quantity:finite.min(0).max(1e6),unit:z.string().max(30)});
 const Budget=define('Budget','Working cost planner: editable quantities, subtotals, total and budget headroom.',{id,label,currency:z.string().min(1).max(12),limit:finite.min(0).max(1e12),items:z.array(CostItem.ref).min(1).max(24)});
 const Place=define('Place','Researched WGS84 place, optional researched photo (empty if absent). Declare image in resources.images.',{id,name:label,lat:finite.min(-85).max(85),lng:finite.min(-180).max(180),detail:text,image:z.string().max(2048),credit:z.string().max(200)});
 const Route=define('Route','Verified route only. Coordinates latitude then longitude.',{id,label,coordinates:z.array(z.tuple([finite.min(-85).max(85),finite.min(-180).max(180)])).min(2).max(2000)});
 const Trip=define('Trip','Real map, photos, place selection and retained ordered itinerary. Reordering does not recalculate roads. Requires resources.map=true.',{id,places:z.array(Place.ref).min(1).max(30),routes:z.array(Route.ref).max(10)});
 const Table=define('Table','Compact comparison table. Each row must have exactly one cell per column. Omit the label when it would repeat the panel title.',{label,columns:z.array(z.string().min(1).max(40)).min(2).max(8),rows:z.array(z.array(z.string().max(160)).min(2).max(8)).min(1).max(40),note:noteText});
 const Chart=define('Chart','Small bar or line chart for a short verified series. labels and values must have equal length. Omit the label when it would repeat the panel title.',{label,kind:z.enum(['bar','line']),labels:z.array(z.string().min(1).max(40)).min(1).max(12),values:z.array(finite).min(1).max(12),unit:z.string().max(20),note:noteText});
 const Field=define('Field','One form field. Use select only with options; other types keep options empty.',{id,label,type:z.enum(['text','number','textarea','select']),placeholder:z.string().max(120),required:z.boolean(),options:z.array(z.string().min(1).max(80)).max(12),unit:z.string().max(20),initial:z.string().max(400)});
 const Form=define('Form','Structured intake with persisted values, inline validation and a fill count. No submit button.',{id,label,fields:z.array(Field.ref).min(1).max(8)});
 const content=[Note,Choice,Budget,Trip,Table,Chart,Form];
 const Stack=define('Stack','Layout only: place two or more compact blocks in a row or column. Do not nest Stack.',{direction:z.enum(['row','column']),children:z.array(z.union(content.map(item=>item.ref))).min(1).max(6)});
 const App=define('App','Compact mini-app root. Compose the few working components needed.',{children:z.array(z.union([...content.map(item=>item.ref),Stack.ref])).min(1).max(12)});
 return createLibrary({root:'App',components:[App,Note,Option,Choice,CostItem,Budget,Place,Route,Trip,Table,Chart,Field,Form,Stack]});
}
const library=makeLibrary();
function validateProgram(code,resources){
 if(typeof code!=='string'||!code.trim()||Buffer.byteLength(code,'utf8')>64*1024||code.trim().startsWith(String.fromCharCode(96)))throw new Error('OpenUI code 必须是不带围栏、至多 64 KiB 的程序。');
 const stripped=code.replace(/"(?:\\.|[^"\\])*"/g,'""');
 if(/[^\w\s"=(),;\[\].-]/.test(stripped)||/\b(?:Query|Mutation)\b/.test(stripped))throw new Error('OpenUI 仅支持组件、引用与字面量。');
 for(const match of stripped.matchAll(/([A-Za-z_]\w*)\s*\(/g))if(!library.components[match[1]])throw new Error('未知 OpenUI 组件：'+match[1]);
 const result=createParser(library.toJSONSchema(),'App').parse(code);
 if(result.meta.incomplete||result.meta.orphaned?.length||result.queryStatements?.length||result.mutationStatements?.length||Object.keys(result.stateDeclarations||{}).length)throw new Error('OpenUI 不接受未使用语句、动态表达式或不完整程序。');
 if(!result.root||result.root.typeName!=='App'||result.meta.errors?.length||result.meta.unresolved?.length)throw new Error('OpenUI 解析失败：'+JSON.stringify({errors:result.meta.errors,unresolved:result.meta.unresolved}).slice(0,1800));
 const contentTypes=['Note','Choice','Budget','Trip','Table','Chart','Form'];
 const childFields={App:{children:[...contentTypes,'Stack']},Stack:{children:contentTypes},Choice:{options:['Option']},Budget:{items:['CostItem']},Trip:{places:['Place'],routes:['Route']},Form:{fields:['Field']}};
 let count=0,coordinates=0;const active=new Set(),stateIds=new Set();
 const walk=(value,depth=0)=>{
  if(++count>16000||depth>30)throw new Error('OpenUI 内容过于复杂。');
  if(value==null||['string','number','boolean'].includes(typeof value))return;
  if(active.has(value))throw new Error('OpenUI 不允许循环引用。');active.add(value);
  if(Array.isArray(value))value.forEach(v=>walk(v,depth+1));
  else{
   if(value.type!=='element'||value.partial||!library.components[value.typeName])throw new Error('OpenUI 仅支持完整的已注册组件；不支持 Query、Mutation 或自定义表达式。');
   if(value.hasDynamicProps)throw new Error('OpenUI 不接受动态表达式。');
   for(const [field,types] of Object.entries(childFields[value.typeName]||{})){
    if(!Array.isArray(value.props[field])||value.props[field].some(child=>!types.includes(child?.typeName)))throw new Error('OpenUI 子组件类型无效。');
   }
   const unwrap=(v,d=0)=>{if(d>30)throw new Error('OpenUI 嵌套过深。');if(Array.isArray(v))return v.map(x=>unwrap(x,d+1));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v.type==='element'?v.props:v).map(([k,x])=>[k,unwrap(x,d+1)]));return v;};
   const valid=library.components[value.typeName].props.safeParse(unwrap(value.props));
   if(!valid.success)throw new Error('OpenUI '+value.typeName+' 参数无效：'+valid.error.message.slice(0,1200));
   const p=value.props;
   if(['Choice','Budget','Trip','Form'].includes(value.typeName)){if(stateIds.has(p.id))throw new Error('交互组件 id 不能重复。');stateIds.add(p.id);}
   const unique=items=>{const ids=items.map(item=>item.props.id);if(new Set(ids).size!==ids.length)throw new Error('条目 id 不能重复。');};
   if(value.typeName==='Choice'){unique(p.options);if(p.initial&&!p.options.some(o=>o.props.id===p.initial))throw new Error('Choice.initial 必须匹配选项。');}
   if(value.typeName==='Budget')unique(p.items);
   if(value.typeName==='Trip'){if(!resources.map)throw new Error('Trip 需要 resources.map=true。');unique([...p.places,...p.routes]);}
   if(value.typeName==='Place'&&p.image&&!resources.images.includes(p.image))throw new Error('Place.image 必须在 resources.images 中声明。');
   if(value.typeName==='Route'&&(coordinates+=p.coordinates.length)>2000)throw new Error('路线坐标总数不能超过 2000。');
   if(value.typeName==='Table'&&p.rows.some(row=>row.length!==p.columns.length))throw new Error('Table 每行的单元格数量必须与列数一致。');
   if(value.typeName==='Chart'&&p.labels.length!==p.values.length)throw new Error('Chart.labels 与 Chart.values 长度必须一致。');
   if(value.typeName==='Form'){
    unique(p.fields);
    for(const field of p.fields){
     const f=field.props;
     if(f.type==='select'){if(!f.options.length)throw new Error('select 字段至少需要一个选项。');if(f.initial&&!f.options.includes(f.initial))throw new Error('select 字段的初始值必须匹配选项。');}
     else if(f.options.length)throw new Error('只有 select 字段可以声明 options。');
    }
   }
   Object.values(p).forEach(v=>walk(v,depth+1));
  }active.delete(value);
 };walk(result.root);return result;
}
const prompt=library.prompt({toolCalls:false,bindings:false,additionalRules:[
 'Output OpenUI Lang in Creator code with format=openui. No HTML, fences, Query, Mutation or expressions. Root is App. Use stable unique ids.',
 'Write no narration. Do not explain what a component does, do not say the data is a sample, do not tell the user to edit or click. A Note carries a unit, source or method only, and a panel has at most one.',
 'The panel title is the heading. Do not repeat it as a Table or Chart label; those labels only distinguish blocks sharing one Stack.',
 'Use Trip for maps/itineraries, Budget for adjustable estimates, Choice for option selection, Table for comparison grids, Chart for a short verified series, Form for structured intake, Stack only to place two compact blocks side by side. For games, physical animations and other custom programs use format=html instead.',
 'Table rows must match the column count. Chart labels and values must have equal length. Form field ids must be unique; only select fields take options. Keep Table, Chart and Form inside App or Stack, never nested in each other.',
 'Research coordinates, geometry and photos first. Declare map/photos in resources. Do not invent routes, images or prices.',
 'Do not add generic save/confirm/summary controls. Choices and form values persist automatically. Bring back to chat is omitted by default: set Creator handoff=true only for a concrete next conversation step requiring the result. It prepares a draft and never sends.'
],examples:['root = App([budget, choice])\nbudget = Budget("room", "预算", "¥", 5000, [paint, light])\npaint = CostItem("paint", "墙面涂料", 280, 3, "桶")\nlight = CostItem("light", "灯具", 420, 2, "盏")\nchoice = Choice("finish", "墙面效果", [matte, gloss], "matte")\nmatte = Option("matte", "哑光", "柔和低反光")\ngloss = Option("gloss", "亮面", "明亮易清洁")','root = App([table, chart])\ntable = Table("方案对比", ["方案", "月费"], [["基础", "¥99"], ["专业", "¥299"]])\nchart = Chart("响应时间", "bar", ["基础", "专业"], [120, 85], "ms")']});
module.exports={makeLibrary,validateProgram,prompt};

// @host 0:1
// Consumer 2: a second file selects the design system saved on this device by Consumer 1, as a whole.
const S=[],post=(m)=>S.push(m),L=(t)=>S.filter((m)=>m.type===t).slice(-1)[0],N=(id)=>figma.getNodeByIdAsync(id);
const K=(key,name)=>({source:'library',key,name}),none={library:false,local:false};
const portable={version:2,name:'Acme (production)',variableCollections:[K('5cf0ef50ff4b4fa46fb026dd0b0b3c857a2ebdb2','Acme Colors'),K('e2cb7862ed001f685edca2b427155603a9fa6a0b','Acme Spacing')],
textStyles:{...none,items:[K('89001002361e7522ad693673283d5061204acb43','Acme / Body'),K('46db04649156f45b2c6aa789b0ddc9a27c01f973','Acme / Button label')]},paintStyles:none,
components:{...none,items:[K('3ab72fbe2d5efade7745efe3c265e6fdd9024203','Acme / Button')]},spacingScale:[0,4,8,12,16,24,32],radiusScale:[0,4,8,12,16,999]};
const shared=DSD.reference.referenceFromSelection(portable,'in-use');
const st=DSD.memoryStorage(null,{library:[shared]}),c=DSD.createController({post,storage:st});
await c.handle({type:'init'});const init=L('init-state');
await c.handle({type:'get-discovery'});const d=L('discovery').discovery;
const v=DSD.validateDesignSystem(portable,{spacing:DSD.parseScale('Spacing scale','0, 4, 8, 12, 16, 24, 32'),radius:DSD.parseScale('Corner radius scale','0, 4, 8, 12, 16, 999')},d);
await c.handle({type:'switch-design-system',id:shared.id});const selected=L('settings-saved').settings.designSystem;
const frame=await N('1:54');figma.currentPage.selection=[frame];await c.handle({type:'run-audit',scope:'selection'});
const r=L('audit-result').result,flag=new Set(r.issues.map((i)=>i.nodeId)),nav=[];
for(const i of r.issues){figma.viewport.center={x:1e5,y:1e5};figma.viewport.zoom=.1;await c.handle({type:'go-to-node',nodeId:i.nodeId});
const s=figma.currentPage.selection;nav.push(`${i.ruleId} ${i.nodeId} → ${i.expectedValue} | ${L('navigate-result').ok&&s.length===1&&s[0].id===i.nodeId}`);}
// Consumer 1's component node id as a local ref must not approve anything here.
const idRef=(await DSD.performAudit([frame],{...DSD.DEFAULT_AUDIT_CONFIG,designSystem:{...portable,components:{...none,items:[{source:'local',id:'1:13',name:'Acme / Button (file 1 id)'}]}}},
{scope:'selection',page:figma.currentPage,total:12,deadline:Date.now()+6e4})).result.issues.filter((i)=>i.ruleId.startsWith('component/')).map((i)=>`${i.ruleId} ${i.nodeId}`);
return{designSystemOnOpen:init.settings.designSystem,offered:init.library.map((x)=>x.name),selectedWhole:JSON.stringify(selected)===JSON.stringify(shared),discovered:d.collections.map((x)=>`${x.name} ${x.id}`),v,
score:r.compliance.score,checks:r.compliance.opportunities,unresolved:r.unresolvedSources,issues:r.issues.map((i)=>`${i.severity} ${i.ruleId} ${i.nodeId}`),
passes:{frame:!flag.has('1:54'),remoteVar:!flag.has('1:55'),remoteStyle:!flag.has('1:57'),instanceApprovedByKey:!flag.has('1:59')},nav,idRef};

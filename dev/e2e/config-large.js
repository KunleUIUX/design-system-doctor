// @host 1:15
// Phase 5 benchmark: 3,601 layers through the real controller with a v2 (ref-based) config.
const S=[],L=(t)=>S.filter((m)=>m.type===t).slice(-1)[0];
const ds={version:2,name:'Acme',variableCollections:[{source:'library',key:'5cf0ef50ff4b4fa46fb026dd0b0b3c857a2ebdb2',name:'Acme Colors'}],
textStyles:{library:true,local:false,items:[]},paintStyles:{library:false,local:false},components:{library:true,local:false,items:[]},spacingScale:[0,4,8,12,16,24],radiusScale:[0,4,8,12,16,999]};
const c=DSD.createController({post:(m)=>S.push(m),storage:DSD.memoryStorage({...DSD.DEFAULT_AUDIT_CONFIG,designSystem:ds})});
await figma.setCurrentPageAsync(await figma.getNodeByIdAsync('1:15'));await c.handle({type:'init'});
figma.currentPage.selection=[await figma.getNodeByIdAsync('1:28')];
const runs=[];for(let k=0;k<2;k++){const t=Date.now();await c.handle({type:'run-audit',scope:'selection',confirmedLarge:true});runs.push(Date.now()-t);}
const r=L('audit-result').result;return{runsMs:runs,scanned:r.scannedNodeCount,checks:r.compliance.opportunities,errors:r.compliance.errored,score:r.compliance.score};

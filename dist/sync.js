import {mergeStates,validateState} from './learning.js';
import {validateBank} from './core.js';
export class CloudSync{
  constructor({getState,replaceState,persist,onStatus,onRemote}){Object.assign(this,{getState,replaceState,persist,onStatus,onRemote});this.revision=0;this.busy=false;this.dirty=false;this.ready=false;this.timer=null;}
  async pull(){
    const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw Error(response.status===401?'请登录后同步':'云端暂时不可用，本机记录已保留');
    const remote=await response.json();if(remote.data)validateState(remote.data,validateBank);
    if(remote.data)this.replaceState(mergeStates(this.getState(),remote.data));
    this.revision=remote.revision;this.persist();this.onRemote?.();return remote;
  }
  async start(){try{await this.pull();this.ready=true;this.onStatus('ready','云端已连接');await this.flush();}catch(e){this.onStatus('offline',e instanceof TypeError?'网络暂不可用，本机记录已保留':e.message);}}
  changed(){this.dirty=true;if(!this.busy)this.onStatus('pending','本机已保存，待同步');clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),900);}
  async flush({refresh=false}={}){
    clearTimeout(this.timer);if(this.busy){this.dirty=true;return;}this.busy=true;this.onStatus('syncing',refresh?'正在检查云端更新':'正在同步');
    try{
      if(!this.ready||refresh){await this.pull();this.ready=true;}
      for(let attempt=0;attempt<4;attempt++){
        this.dirty=false;const snapshot=structuredClone(this.getState()),serialized=JSON.stringify(snapshot);
        this.onStatus('syncing','正在同步');
        const response=await fetch('/api/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({baseRevision:this.revision,data:snapshot})});
        const payload=await response.json();
        if(response.status===409){if(payload.data)validateState(payload.data,validateBank);this.replaceState(mergeStates(this.getState(),payload.data));this.revision=payload.revision;this.persist();this.onRemote?.();continue;}
        if(!response.ok)throw Error(response.status===413?'学习备份较大，请先导出保存；本机记录仍在':response.status===401?'请登录后同步':'同步暂未成功，本机记录已保留');
        this.revision=payload.revision;
        if(this.dirty||JSON.stringify(this.getState())!==serialized)continue;
        this.onStatus('synced','已同步 '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));return;
      }
      this.dirty=true;this.onStatus('pending','另一设备也在更新，稍后自动合并');this.timer=setTimeout(()=>this.flush({refresh:true}),3500);
    }catch(e){this.dirty=true;this.onStatus('offline',e instanceof TypeError?'网络暂不可用，本机记录已保留':e.message);}finally{this.busy=false;}
  }
}

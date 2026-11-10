import {syncRequestNotifications} from '../utils/request-notifications.js';
export async function onRequest({request,env}){
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 if(!env.SCHEDULE_SECRET||request.headers.get('Authorization')!=='Bearer '+env.SCHEDULE_SECRET)return new Response('Forbidden',{status:403});
 try{await syncRequestNotifications(env);return Response.json({ok:true})}catch(e){console.error(e);return Response.json({error:'消息同步失败'},{status:502})}
}

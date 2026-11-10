import {getFileFromGitee} from './utils/gitee.js';
import {effectiveSettings} from './utils/schedules.js';
import {resolveSession,checkSubmissionRisk} from './utils/account-sessions.js';
function rateLimitResponse(error) {
  if (error.code !== 'GITEE_RATE_LIMIT') return null;
  return Response.json({error:'数据服务请求过多，请稍后重试',code:error.code},{status:429,headers:{'Retry-After':String(error.retryAfter || 15)}});
}
/** Cloudflare Pages: no API/browser caching except music media and published image files. */
export async function onRequest(context) {
  const { request, next, env } = context;
  const resourceURL=new URL(request.url);const path=resourceURL.pathname.replace(/\/+$/, '') || '/';
  if(/^\/(?:\.git|\.env|data|tests|deployment)(?:\/|$)/i.test(path)||(!path.startsWith('/api/')&&/\.(?:bak|sql|zip|log)$/i.test(path)))return new Response('Not found',{status:404});
  let forwarded=request;
  if(path.startsWith('/api/')){
    const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
    if(/^(fake-jwt-|student-jwt-)/.test(token))return Response.json({state:'revoked',error:'请重新登录'},{status:401});
    if(/^\/api\/(about|music)(?:\/|$)/.test(path)&&!['GET','HEAD','OPTIONS'].includes(request.method)){
      try{
        const current=await resolveSession(context.env,request.headers.get('X-Account-Session'));
        if(current.state!=='online'||current.account.role!=='system')return Response.json({error:'系统账户登录已失效'},{status:401});
      }catch(error){return rateLimitResponse(error) || Response.json({error:'会话服务暂时不可用'},{status:503});}
    }
    if(token.startsWith('session-')){
      try{
        const session=await resolveSession(context.env,token);
        context.data.accountSession=session;
        if(path!=='/api/account-security'&&session.state!=='online')return Response.json({code:session.state==='banned'?'ACCOUNT_BANNED':'SESSION_REVOKED',error:session.state==='banned'?'账户已被封禁':'登录已失效',banReason:session.banReason,banUntil:session.banUntil},{status:401});
        if(session.state==='online'){
          const headers=new Headers(request.headers);
          headers.set('Authorization','Bearer '+(session.row.kind==='admin'?'fake-jwt-':'student-jwt-')+session.row.id);
          forwarded=new Request(request,{headers});
        }
      }catch(error){return rateLimitResponse(error) || Response.json({error:'会话服务暂时不可用'},{status:503});}
    }
  }
  const studentPage = /^\/(?:file-upload|messages|assigned-request|student-login)(?:\.html)?\/?$/.test(path);
  const studentApi = /^\/api\/(?:apps|requests|file-tasks|files|uploads|messages|students)(?:\/|$)/.test(path);
  const administrator = context.data?.accountSession?.row?.kind === 'admin';
  const studentHome = /^\/home(?:\.html)?\/?$/.test(path) && resourceURL.searchParams.get('view') !== 'admin';
  const applicationWrite = path === '/api/apps' && ['POST','PUT'].includes(request.method);
  if (studentHome || studentPage || (studentApi && !administrator)) {
    try {
      const {content} = await getFileFromGitee(env, 'data/settings.json');
      if (applicationWrite) context.data.applicationSettings = content;
      if (effectiveSettings(content || {}).systemClosed) {
        if (studentHome || studentPage) return new Response(null,{status:302,headers:{Location:'/index.html','Cache-Control':'no-store'}});
        return Response.json({error:'学分服务中心已停止服务'},{status:503,headers:{'Cache-Control':'no-store'}});
      }
    } catch (error) {
      if (applicationWrite) context.data.applicationSettingsError = error;
      else console.warn('[system status]', error.message);
    }
  }
  const session=context.data?.accountSession;
  const riskSubmission=session?.state==='online' && session.row.kind==='student' &&
    ((request.method==='POST' && ['/api/apps','/api/requests','/api/files'].includes(path)) ||
     (request.method==='PUT' && path==='/api/apps'));
  if(riskSubmission){
    try{
      const ban=await checkSubmissionRisk(env,session);
      if(ban)return Response.json({code:'ACCOUNT_BANNED',error:ban.reason,banReason:ban.reason,banUntil:ban.until},{status:403});
    }catch(error){return rateLimitResponse(error) || Response.json({error:'暂时无法检查提交频率，请稍后重试'},{status:503});}
  }
  const original = await next(forwarded);
  const headers = new Headers(original.headers);
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('X-Frame-Options','SAMEORIGIN');
  headers.set('Content-Security-Policy',"frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  if(resourceURL.protocol==='https:')headers.set('Strict-Transport-Security','max-age=31536000');

  const staticAsset=/^\/(assets|vendor)\//.test(path)||path==='/api-cache.js';
  const cacheableStatus=[200,206,304].includes(original.status);
  const media=/^\/api\/music\/[^/]+$/.test(path)
    ||/^\/api\/screenshots\/[^/]+\/[^/]+$/.test(path)
    ||/^\/api\/uploads\/[^/]+\/[^/]+\.(png|jpe?g|gif|webp|avif)$/i.test(path);

  if(staticAsset&&cacheableStatus){
    const policy=resourceURL.searchParams.has('v')
      ?'public, max-age=31536000, immutable'
      :path.startsWith('/vendor/')?'public, max-age=604800, immutable':'public, no-cache, max-age=0, must-revalidate';
    headers.set('Cache-Control',policy);
    headers.delete('Pragma');
    headers.delete('Expires');
  }else if(!media||!cacheableStatus){
    headers.set('Cache-Control','no-store, max-age=0');
    headers.set('Pragma','no-cache');
    headers.set('Expires','0');
  }
  return new Response(original.body,{status:original.status,statusText:original.statusText,headers});
}

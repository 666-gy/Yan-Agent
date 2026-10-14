(()=>{var sS=Object.create;var Sg=Object.defineProperty;var rS=Object.getOwnPropertyDescriptor;var aS=Object.getOwnPropertyNames;var oS=Object.getPrototypeOf,lS=Object.prototype.hasOwnProperty;var Ai=(t,e)=>()=>(e||t((e={exports:{}}).exports,e),e.exports);var cS=(t,e,n,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(let s of aS(e))!lS.call(t,s)&&s!==n&&Sg(t,s,{get:()=>e[s],enumerable:!(i=rS(e,s))||i.enumerable});return t};var ar=(t,e,n)=>(n=t!=null?sS(oS(t)):{},cS(e||!t||!t.__esModule?Sg(n,"default",{value:t,enumerable:!0}):n,t));var Pg=Ai(ze=>{"use strict";var gh=Symbol.for("react.transitional.element"),uS=Symbol.for("react.portal"),fS=Symbol.for("react.fragment"),hS=Symbol.for("react.strict_mode"),dS=Symbol.for("react.profiler"),pS=Symbol.for("react.consumer"),mS=Symbol.for("react.context"),gS=Symbol.for("react.forward_ref"),vS=Symbol.for("react.suspense"),xS=Symbol.for("react.memo"),Cg=Symbol.for("react.lazy"),Mg=Symbol.iterator;function yS(t){return t===null||typeof t!="object"?null:(t=Mg&&t[Mg]||t["@@iterator"],typeof t=="function"?t:null)}var Rg={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},Dg=Object.assign,Ug={};function qr(t,e,n){this.props=t,this.context=e,this.refs=Ug,this.updater=n||Rg}qr.prototype.isReactComponent={};qr.prototype.setState=function(t,e){if(typeof t!="object"&&typeof t!="function"&&t!=null)throw Error("takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,t,e,"setState")};qr.prototype.forceUpdate=function(t){this.updater.enqueueForceUpdate(this,t,"forceUpdate")};function Bg(){}Bg.prototype=qr.prototype;function vh(t,e,n){this.props=t,this.context=e,this.refs=Ug,this.updater=n||Rg}var xh=vh.prototype=new Bg;xh.constructor=vh;Dg(xh,qr.prototype);xh.isPureReactComponent=!0;var Eg=Array.isArray,St={H:null,A:null,T:null,S:null,V:null},Ig=Object.prototype.hasOwnProperty;function yh(t,e,n,i,s,r){return n=r.ref,{$$typeof:gh,type:t,key:e,ref:n!==void 0?n:null,props:r}}function _S(t,e){return yh(t.type,e,void 0,void 0,void 0,t.props)}function _h(t){return typeof t=="object"&&t!==null&&t.$$typeof===gh}function AS(t){var e={"=":"=0",":":"=2"};return"$"+t.replace(/[=:]/g,function(n){return e[n]})}var Tg=/\/+/g;function mh(t,e){return typeof t=="object"&&t!==null&&t.key!=null?AS(""+t.key):e.toString(36)}function bg(){}function SS(t){switch(t.status){case"fulfilled":return t.value;case"rejected":throw t.reason;default:switch(typeof t.status=="string"?t.then(bg,bg):(t.status="pending",t.then(function(e){t.status==="pending"&&(t.status="fulfilled",t.value=e)},function(e){t.status==="pending"&&(t.status="rejected",t.reason=e)})),t.status){case"fulfilled":return t.value;case"rejected":throw t.reason}}throw t}function Yr(t,e,n,i,s){var r=typeof t;(r==="undefined"||r==="boolean")&&(t=null);var a=!1;if(t===null)a=!0;else switch(r){case"bigint":case"string":case"number":a=!0;break;case"object":switch(t.$$typeof){case gh:case uS:a=!0;break;case Cg:return a=t._init,Yr(a(t._payload),e,n,i,s)}}if(a)return s=s(t),a=i===""?"."+mh(t,0):i,Eg(s)?(n="",a!=null&&(n=a.replace(Tg,"$&/")+"/"),Yr(s,e,n,"",function(c){return c})):s!=null&&(_h(s)&&(s=_S(s,n+(s.key==null||t&&t.key===s.key?"":(""+s.key).replace(Tg,"$&/")+"/")+a)),e.push(s)),1;a=0;var o=i===""?".":i+":";if(Eg(t))for(var l=0;l<t.length;l++)i=t[l],r=o+mh(i,l),a+=Yr(i,e,n,r,s);else if(l=yS(t),typeof l=="function")for(t=l.call(t),l=0;!(i=t.next()).done;)i=i.value,r=o+mh(i,l++),a+=Yr(i,e,n,r,s);else if(r==="object"){if(typeof t.then=="function")return Yr(SS(t),e,n,i,s);throw e=String(t),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(t).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.")}return a}function jl(t,e,n){if(t==null)return t;var i=[],s=0;return Yr(t,i,"","",function(r){return e.call(n,r,s++)}),i}function MS(t){if(t._status===-1){var e=t._result;e=e(),e.then(function(n){(t._status===0||t._status===-1)&&(t._status=1,t._result=n)},function(n){(t._status===0||t._status===-1)&&(t._status=2,t._result=n)}),t._status===-1&&(t._status=0,t._result=e)}if(t._status===1)return t._result.default;throw t._result}var wg=typeof reportError=="function"?reportError:function(t){if(typeof window=="object"&&typeof window.ErrorEvent=="function"){var e=new window.ErrorEvent("error",{bubbles:!0,cancelable:!0,message:typeof t=="object"&&t!==null&&typeof t.message=="string"?String(t.message):String(t),error:t});if(!window.dispatchEvent(e))return}else if(typeof process=="object"&&typeof process.emit=="function"){process.emit("uncaughtException",t);return}console.error(t)};function ES(){}ze.Children={map:jl,forEach:function(t,e,n){jl(t,function(){e.apply(this,arguments)},n)},count:function(t){var e=0;return jl(t,function(){e++}),e},toArray:function(t){return jl(t,function(e){return e})||[]},only:function(t){if(!_h(t))throw Error("React.Children.only expected to receive a single React element child.");return t}};ze.Component=qr;ze.Fragment=fS;ze.Profiler=dS;ze.PureComponent=vh;ze.StrictMode=hS;ze.Suspense=vS;ze.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=St;ze.__COMPILER_RUNTIME={__proto__:null,c:function(t){return St.H.useMemoCache(t)}};ze.cache=function(t){return function(){return t.apply(null,arguments)}};ze.cloneElement=function(t,e,n){if(t==null)throw Error("The argument must be a React element, but you passed "+t+".");var i=Dg({},t.props),s=t.key,r=void 0;if(e!=null)for(a in e.ref!==void 0&&(r=void 0),e.key!==void 0&&(s=""+e.key),e)!Ig.call(e,a)||a==="key"||a==="__self"||a==="__source"||a==="ref"&&e.ref===void 0||(i[a]=e[a]);var a=arguments.length-2;if(a===1)i.children=n;else if(1<a){for(var o=Array(a),l=0;l<a;l++)o[l]=arguments[l+2];i.children=o}return yh(t.type,s,void 0,void 0,r,i)};ze.createContext=function(t){return t={$$typeof:mS,_currentValue:t,_currentValue2:t,_threadCount:0,Provider:null,Consumer:null},t.Provider=t,t.Consumer={$$typeof:pS,_context:t},t};ze.createElement=function(t,e,n){var i,s={},r=null;if(e!=null)for(i in e.key!==void 0&&(r=""+e.key),e)Ig.call(e,i)&&i!=="key"&&i!=="__self"&&i!=="__source"&&(s[i]=e[i]);var a=arguments.length-2;if(a===1)s.children=n;else if(1<a){for(var o=Array(a),l=0;l<a;l++)o[l]=arguments[l+2];s.children=o}if(t&&t.defaultProps)for(i in a=t.defaultProps,a)s[i]===void 0&&(s[i]=a[i]);return yh(t,r,void 0,void 0,null,s)};ze.createRef=function(){return{current:null}};ze.forwardRef=function(t){return{$$typeof:gS,render:t}};ze.isValidElement=_h;ze.lazy=function(t){return{$$typeof:Cg,_payload:{_status:-1,_result:t},_init:MS}};ze.memo=function(t,e){return{$$typeof:xS,type:t,compare:e===void 0?null:e}};ze.startTransition=function(t){var e=St.T,n={};St.T=n;try{var i=t(),s=St.S;s!==null&&s(n,i),typeof i=="object"&&i!==null&&typeof i.then=="function"&&i.then(ES,wg)}catch(r){wg(r)}finally{St.T=e}};ze.unstable_useCacheRefresh=function(){return St.H.useCacheRefresh()};ze.use=function(t){return St.H.use(t)};ze.useActionState=function(t,e,n){return St.H.useActionState(t,e,n)};ze.useCallback=function(t,e){return St.H.useCallback(t,e)};ze.useContext=function(t){return St.H.useContext(t)};ze.useDebugValue=function(){};ze.useDeferredValue=function(t,e){return St.H.useDeferredValue(t,e)};ze.useEffect=function(t,e,n){var i=St.H;if(typeof n=="function")throw Error("useEffect CRUD overload is not enabled in this build of React.");return i.useEffect(t,e)};ze.useId=function(){return St.H.useId()};ze.useImperativeHandle=function(t,e,n){return St.H.useImperativeHandle(t,e,n)};ze.useInsertionEffect=function(t,e){return St.H.useInsertionEffect(t,e)};ze.useLayoutEffect=function(t,e){return St.H.useLayoutEffect(t,e)};ze.useMemo=function(t,e){return St.H.useMemo(t,e)};ze.useOptimistic=function(t,e){return St.H.useOptimistic(t,e)};ze.useReducer=function(t,e,n){return St.H.useReducer(t,e,n)};ze.useRef=function(t){return St.H.useRef(t)};ze.useState=function(t){return St.H.useState(t)};ze.useSyncExternalStore=function(t,e,n){return St.H.useSyncExternalStore(t,e,n)};ze.useTransition=function(){return St.H.useTransition()};ze.version="19.1.1"});var ho=Ai((hR,Lg)=>{"use strict";Lg.exports=Pg()});var Xg=Ai(Mt=>{"use strict";function Eh(t,e){var n=t.length;t.push(e);e:for(;0<n;){var i=n-1>>>1,s=t[i];if(0<$l(s,e))t[i]=e,t[n]=s,n=i;else break e}}function Si(t){return t.length===0?null:t[0]}function tc(t){if(t.length===0)return null;var e=t[0],n=t.pop();if(n!==e){t[0]=n;e:for(var i=0,s=t.length,r=s>>>1;i<r;){var a=2*(i+1)-1,o=t[a],l=a+1,c=t[l];if(0>$l(o,n))l<s&&0>$l(c,o)?(t[i]=c,t[l]=n,i=l):(t[i]=o,t[a]=n,i=a);else if(l<s&&0>$l(c,n))t[i]=c,t[l]=n,i=l;else break e}}return e}function $l(t,e){var n=t.sortIndex-e.sortIndex;return n!==0?n:t.id-e.id}Mt.unstable_now=void 0;typeof performance=="object"&&typeof performance.now=="function"?(Ng=performance,Mt.unstable_now=function(){return Ng.now()}):(Ah=Date,Og=Ah.now(),Mt.unstable_now=function(){return Ah.now()-Og});var Ng,Ah,Og,zi=[],fs=[],TS=1,Zn=null,ln=3,Th=!1,po=!1,mo=!1,bh=!1,Hg=typeof setTimeout=="function"?setTimeout:null,Gg=typeof clearTimeout=="function"?clearTimeout:null,Fg=typeof setImmediate<"u"?setImmediate:null;function ec(t){for(var e=Si(fs);e!==null;){if(e.callback===null)tc(fs);else if(e.startTime<=t)tc(fs),e.sortIndex=e.expirationTime,Eh(zi,e);else break;e=Si(fs)}}function wh(t){if(mo=!1,ec(t),!po)if(Si(zi)!==null)po=!0,Zr||(Zr=!0,Qr());else{var e=Si(fs);e!==null&&Ch(wh,e.startTime-t)}}var Zr=!1,go=-1,kg=5,Vg=-1;function Wg(){return bh?!0:!(Mt.unstable_now()-Vg<kg)}function Sh(){if(bh=!1,Zr){var t=Mt.unstable_now();Vg=t;var e=!0;try{e:{po=!1,mo&&(mo=!1,Gg(go),go=-1),Th=!0;var n=ln;try{t:{for(ec(t),Zn=Si(zi);Zn!==null&&!(Zn.expirationTime>t&&Wg());){var i=Zn.callback;if(typeof i=="function"){Zn.callback=null,ln=Zn.priorityLevel;var s=i(Zn.expirationTime<=t);if(t=Mt.unstable_now(),typeof s=="function"){Zn.callback=s,ec(t),e=!0;break t}Zn===Si(zi)&&tc(zi),ec(t)}else tc(zi);Zn=Si(zi)}if(Zn!==null)e=!0;else{var r=Si(fs);r!==null&&Ch(wh,r.startTime-t),e=!1}}break e}finally{Zn=null,ln=n,Th=!1}e=void 0}}finally{e?Qr():Zr=!1}}}var Qr;typeof Fg=="function"?Qr=function(){Fg(Sh)}:typeof MessageChannel<"u"?(Mh=new MessageChannel,zg=Mh.port2,Mh.port1.onmessage=Sh,Qr=function(){zg.postMessage(null)}):Qr=function(){Hg(Sh,0)};var Mh,zg;function Ch(t,e){go=Hg(function(){t(Mt.unstable_now())},e)}Mt.unstable_IdlePriority=5;Mt.unstable_ImmediatePriority=1;Mt.unstable_LowPriority=4;Mt.unstable_NormalPriority=3;Mt.unstable_Profiling=null;Mt.unstable_UserBlockingPriority=2;Mt.unstable_cancelCallback=function(t){t.callback=null};Mt.unstable_forceFrameRate=function(t){0>t||125<t?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):kg=0<t?Math.floor(1e3/t):5};Mt.unstable_getCurrentPriorityLevel=function(){return ln};Mt.unstable_next=function(t){switch(ln){case 1:case 2:case 3:var e=3;break;default:e=ln}var n=ln;ln=e;try{return t()}finally{ln=n}};Mt.unstable_requestPaint=function(){bh=!0};Mt.unstable_runWithPriority=function(t,e){switch(t){case 1:case 2:case 3:case 4:case 5:break;default:t=3}var n=ln;ln=t;try{return e()}finally{ln=n}};Mt.unstable_scheduleCallback=function(t,e,n){var i=Mt.unstable_now();switch(typeof n=="object"&&n!==null?(n=n.delay,n=typeof n=="number"&&0<n?i+n:i):n=i,t){case 1:var s=-1;break;case 2:s=250;break;case 5:s=1073741823;break;case 4:s=1e4;break;default:s=5e3}return s=n+s,t={id:TS++,callback:e,priorityLevel:t,startTime:n,expirationTime:s,sortIndex:-1},n>i?(t.sortIndex=n,Eh(fs,t),Si(zi)===null&&t===Si(fs)&&(mo?(Gg(go),go=-1):mo=!0,Ch(wh,n-i))):(t.sortIndex=s,Eh(zi,t),po||Th||(po=!0,Zr||(Zr=!0,Qr()))),t};Mt.unstable_shouldYield=Wg;Mt.unstable_wrapCallback=function(t){var e=ln;return function(){var n=ln;ln=e;try{return t.apply(this,arguments)}finally{ln=n}}}});var qg=Ai((pR,Yg)=>{"use strict";Yg.exports=Xg()});var Zg=Ai(_n=>{"use strict";var bS=ho();function Qg(t){var e="https://react.dev/errors/"+t;if(1<arguments.length){e+="?args[]="+encodeURIComponent(arguments[1]);for(var n=2;n<arguments.length;n++)e+="&args[]="+encodeURIComponent(arguments[n])}return"Minified React error #"+t+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}function hs(){}var yn={d:{f:hs,r:function(){throw Error(Qg(522))},D:hs,C:hs,L:hs,m:hs,X:hs,S:hs,M:hs},p:0,findDOMNode:null},wS=Symbol.for("react.portal");function CS(t,e,n){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:wS,key:i==null?null:""+i,children:t,containerInfo:e,implementation:n}}var vo=bS.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;function nc(t,e){if(t==="font")return"";if(typeof e=="string")return e==="use-credentials"?e:""}_n.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=yn;_n.createPortal=function(t,e){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!e||e.nodeType!==1&&e.nodeType!==9&&e.nodeType!==11)throw Error(Qg(299));return CS(t,e,null,n)};_n.flushSync=function(t){var e=vo.T,n=yn.p;try{if(vo.T=null,yn.p=2,t)return t()}finally{vo.T=e,yn.p=n,yn.d.f()}};_n.preconnect=function(t,e){typeof t=="string"&&(e?(e=e.crossOrigin,e=typeof e=="string"?e==="use-credentials"?e:"":void 0):e=null,yn.d.C(t,e))};_n.prefetchDNS=function(t){typeof t=="string"&&yn.d.D(t)};_n.preinit=function(t,e){if(typeof t=="string"&&e&&typeof e.as=="string"){var n=e.as,i=nc(n,e.crossOrigin),s=typeof e.integrity=="string"?e.integrity:void 0,r=typeof e.fetchPriority=="string"?e.fetchPriority:void 0;n==="style"?yn.d.S(t,typeof e.precedence=="string"?e.precedence:void 0,{crossOrigin:i,integrity:s,fetchPriority:r}):n==="script"&&yn.d.X(t,{crossOrigin:i,integrity:s,fetchPriority:r,nonce:typeof e.nonce=="string"?e.nonce:void 0})}};_n.preinitModule=function(t,e){if(typeof t=="string")if(typeof e=="object"&&e!==null){if(e.as==null||e.as==="script"){var n=nc(e.as,e.crossOrigin);yn.d.M(t,{crossOrigin:n,integrity:typeof e.integrity=="string"?e.integrity:void 0,nonce:typeof e.nonce=="string"?e.nonce:void 0})}}else e==null&&yn.d.M(t)};_n.preload=function(t,e){if(typeof t=="string"&&typeof e=="object"&&e!==null&&typeof e.as=="string"){var n=e.as,i=nc(n,e.crossOrigin);yn.d.L(t,n,{crossOrigin:i,integrity:typeof e.integrity=="string"?e.integrity:void 0,nonce:typeof e.nonce=="string"?e.nonce:void 0,type:typeof e.type=="string"?e.type:void 0,fetchPriority:typeof e.fetchPriority=="string"?e.fetchPriority:void 0,referrerPolicy:typeof e.referrerPolicy=="string"?e.referrerPolicy:void 0,imageSrcSet:typeof e.imageSrcSet=="string"?e.imageSrcSet:void 0,imageSizes:typeof e.imageSizes=="string"?e.imageSizes:void 0,media:typeof e.media=="string"?e.media:void 0})}};_n.preloadModule=function(t,e){if(typeof t=="string")if(e){var n=nc(e.as,e.crossOrigin);yn.d.m(t,{as:typeof e.as=="string"&&e.as!=="script"?e.as:void 0,crossOrigin:n,integrity:typeof e.integrity=="string"?e.integrity:void 0})}else yn.d.m(t)};_n.requestFormReset=function(t){yn.d.r(t)};_n.unstable_batchedUpdates=function(t,e){return t(e)};_n.useFormState=function(t,e,n){return vo.H.useFormState(t,e,n)};_n.useFormStatus=function(){return vo.H.useHostTransitionStatus()};_n.version="19.1.1"});var jg=Ai((gR,Jg)=>{"use strict";function Kg(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(Kg)}catch(t){console.error(t)}}Kg(),Jg.exports=Zg()});var e_=Ai(Eu=>{"use strict";var Wt=qg(),_0=ho(),RS=jg();function Q(t){var e="https://react.dev/errors/"+t;if(1<arguments.length){e+="?args[]="+encodeURIComponent(arguments[1]);for(var n=2;n<arguments.length;n++)e+="&args[]="+encodeURIComponent(arguments[n])}return"Minified React error #"+t+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}function A0(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11)}function sl(t){var e=t,n=t;if(t.alternate)for(;e.return;)e=e.return;else{t=e;do e=t,(e.flags&4098)!==0&&(n=e.return),t=e.return;while(t)}return e.tag===3?n:null}function S0(t){if(t.tag===13){var e=t.memoizedState;if(e===null&&(t=t.alternate,t!==null&&(e=t.memoizedState)),e!==null)return e.dehydrated}return null}function $g(t){if(sl(t)!==t)throw Error(Q(188))}function DS(t){var e=t.alternate;if(!e){if(e=sl(t),e===null)throw Error(Q(188));return e!==t?null:t}for(var n=t,i=e;;){var s=n.return;if(s===null)break;var r=s.alternate;if(r===null){if(i=s.return,i!==null){n=i;continue}break}if(s.child===r.child){for(r=s.child;r;){if(r===n)return $g(s),t;if(r===i)return $g(s),e;r=r.sibling}throw Error(Q(188))}if(n.return!==i.return)n=s,i=r;else{for(var a=!1,o=s.child;o;){if(o===n){a=!0,n=s,i=r;break}if(o===i){a=!0,i=s,n=r;break}o=o.sibling}if(!a){for(o=r.child;o;){if(o===n){a=!0,n=r,i=s;break}if(o===i){a=!0,i=r,n=s;break}o=o.sibling}if(!a)throw Error(Q(189))}}if(n.alternate!==i)throw Error(Q(190))}if(n.tag!==3)throw Error(Q(188));return n.stateNode.current===n?t:e}function M0(t){var e=t.tag;if(e===5||e===26||e===27||e===6)return t;for(t=t.child;t!==null;){if(e=M0(t),e!==null)return e;t=t.sibling}return null}var yt=Object.assign,US=Symbol.for("react.element"),ic=Symbol.for("react.transitional.element"),bo=Symbol.for("react.portal"),na=Symbol.for("react.fragment"),E0=Symbol.for("react.strict_mode"),ad=Symbol.for("react.profiler"),BS=Symbol.for("react.provider"),T0=Symbol.for("react.consumer"),Wi=Symbol.for("react.context"),tp=Symbol.for("react.forward_ref"),od=Symbol.for("react.suspense"),ld=Symbol.for("react.suspense_list"),np=Symbol.for("react.memo"),ms=Symbol.for("react.lazy");Symbol.for("react.scope");var cd=Symbol.for("react.activity");Symbol.for("react.legacy_hidden");Symbol.for("react.tracing_marker");var IS=Symbol.for("react.memo_cache_sentinel");Symbol.for("react.view_transition");var ev=Symbol.iterator;function xo(t){return t===null||typeof t!="object"?null:(t=ev&&t[ev]||t["@@iterator"],typeof t=="function"?t:null)}var PS=Symbol.for("react.client.reference");function ud(t){if(t==null)return null;if(typeof t=="function")return t.$$typeof===PS?null:t.displayName||t.name||null;if(typeof t=="string")return t;switch(t){case na:return"Fragment";case ad:return"Profiler";case E0:return"StrictMode";case od:return"Suspense";case ld:return"SuspenseList";case cd:return"Activity"}if(typeof t=="object")switch(t.$$typeof){case bo:return"Portal";case Wi:return(t.displayName||"Context")+".Provider";case T0:return(t._context.displayName||"Context")+".Consumer";case tp:var e=t.render;return t=t.displayName,t||(t=e.displayName||e.name||"",t=t!==""?"ForwardRef("+t+")":"ForwardRef"),t;case np:return e=t.displayName||null,e!==null?e:ud(t.type)||"Memo";case ms:e=t._payload,t=t._init;try{return ud(t(e))}catch{}}return null}var wo=Array.isArray,De=_0.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,it=RS.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,fr={pending:!1,data:null,method:null,action:null},fd=[],ia=-1;function Ri(t){return{current:t}}function tn(t){0>ia||(t.current=fd[ia],fd[ia]=null,ia--)}function Tt(t,e){ia++,fd[ia]=t.current,t.current=e}var bi=Ri(null),Wo=Ri(null),Ts=Ri(null),Ic=Ri(null);function Pc(t,e){switch(Tt(Ts,e),Tt(Wo,t),Tt(bi,null),e.nodeType){case 9:case 11:t=(t=e.documentElement)&&(t=t.namespaceURI)?a0(t):0;break;default:if(t=e.tagName,e=e.namespaceURI)e=a0(e),t=ky(e,t);else switch(t){case"svg":t=1;break;case"math":t=2;break;default:t=0}}tn(bi),Tt(bi,t)}function Sa(){tn(bi),tn(Wo),tn(Ts)}function hd(t){t.memoizedState!==null&&Tt(Ic,t);var e=bi.current,n=ky(e,t.type);e!==n&&(Tt(Wo,t),Tt(bi,n))}function Lc(t){Wo.current===t&&(tn(bi),tn(Wo)),Ic.current===t&&(tn(Ic),el._currentValue=fr)}var dd=Object.prototype.hasOwnProperty,ip=Wt.unstable_scheduleCallback,Rh=Wt.unstable_cancelCallback,LS=Wt.unstable_shouldYield,NS=Wt.unstable_requestPaint,wi=Wt.unstable_now,OS=Wt.unstable_getCurrentPriorityLevel,b0=Wt.unstable_ImmediatePriority,w0=Wt.unstable_UserBlockingPriority,Nc=Wt.unstable_NormalPriority,FS=Wt.unstable_LowPriority,C0=Wt.unstable_IdlePriority,zS=Wt.log,HS=Wt.unstable_setDisableYieldValue,rl=null,Nn=null;function As(t){if(typeof zS=="function"&&HS(t),Nn&&typeof Nn.setStrictMode=="function")try{Nn.setStrictMode(rl,t)}catch{}}var On=Math.clz32?Math.clz32:VS,GS=Math.log,kS=Math.LN2;function VS(t){return t>>>=0,t===0?32:31-(GS(t)/kS|0)|0}var sc=256,rc=4194304;function lr(t){var e=t&42;if(e!==0)return e;switch(t&-t){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:return 64;case 128:return 128;case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t&4194048;case 4194304:case 8388608:case 16777216:case 33554432:return t&62914560;case 67108864:return 67108864;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 0;default:return t}}function cu(t,e,n){var i=t.pendingLanes;if(i===0)return 0;var s=0,r=t.suspendedLanes,a=t.pingedLanes;t=t.warmLanes;var o=i&134217727;return o!==0?(i=o&~r,i!==0?s=lr(i):(a&=o,a!==0?s=lr(a):n||(n=o&~t,n!==0&&(s=lr(n))))):(o=i&~r,o!==0?s=lr(o):a!==0?s=lr(a):n||(n=i&~t,n!==0&&(s=lr(n)))),s===0?0:e!==0&&e!==s&&(e&r)===0&&(r=s&-s,n=e&-e,r>=n||r===32&&(n&4194048)!==0)?e:s}function al(t,e){return(t.pendingLanes&~(t.suspendedLanes&~t.pingedLanes)&e)===0}function WS(t,e){switch(t){case 1:case 2:case 4:case 8:case 64:return e+250;case 16:case 32:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:return-1;case 67108864:case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function R0(){var t=sc;return sc<<=1,(sc&4194048)===0&&(sc=256),t}function D0(){var t=rc;return rc<<=1,(rc&62914560)===0&&(rc=4194304),t}function Dh(t){for(var e=[],n=0;31>n;n++)e.push(t);return e}function ol(t,e){t.pendingLanes|=e,e!==268435456&&(t.suspendedLanes=0,t.pingedLanes=0,t.warmLanes=0)}function XS(t,e,n,i,s,r){var a=t.pendingLanes;t.pendingLanes=n,t.suspendedLanes=0,t.pingedLanes=0,t.warmLanes=0,t.expiredLanes&=n,t.entangledLanes&=n,t.errorRecoveryDisabledLanes&=n,t.shellSuspendCounter=0;var o=t.entanglements,l=t.expirationTimes,c=t.hiddenUpdates;for(n=a&~n;0<n;){var f=31-On(n),p=1<<f;o[f]=0,l[f]=-1;var h=c[f];if(h!==null)for(c[f]=null,f=0;f<h.length;f++){var d=h[f];d!==null&&(d.lane&=-536870913)}n&=~p}i!==0&&U0(t,i,0),r!==0&&s===0&&t.tag!==0&&(t.suspendedLanes|=r&~(a&~e))}function U0(t,e,n){t.pendingLanes|=e,t.suspendedLanes&=~e;var i=31-On(e);t.entangledLanes|=e,t.entanglements[i]=t.entanglements[i]|1073741824|n&4194090}function B0(t,e){var n=t.entangledLanes|=e;for(t=t.entanglements;n;){var i=31-On(n),s=1<<i;s&e|t[i]&e&&(t[i]|=e),n&=~s}}function sp(t){switch(t){case 2:t=1;break;case 8:t=4;break;case 32:t=16;break;case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:t=128;break;case 268435456:t=134217728;break;default:t=0}return t}function rp(t){return t&=-t,2<t?8<t?(t&134217727)!==0?32:268435456:8:2}function I0(){var t=it.p;return t!==0?t:(t=window.event,t===void 0?32:jy(t.type))}function YS(t,e){var n=it.p;try{return it.p=t,e()}finally{it.p=n}}var Ns=Math.random().toString(36).slice(2),cn="__reactFiber$"+Ns,wn="__reactProps$"+Ns,Ia="__reactContainer$"+Ns,pd="__reactEvents$"+Ns,qS="__reactListeners$"+Ns,QS="__reactHandles$"+Ns,tv="__reactResources$"+Ns,ll="__reactMarker$"+Ns;function ap(t){delete t[cn],delete t[wn],delete t[pd],delete t[qS],delete t[QS]}function sa(t){var e=t[cn];if(e)return e;for(var n=t.parentNode;n;){if(e=n[Ia]||n[cn]){if(n=e.alternate,e.child!==null||n!==null&&n.child!==null)for(t=c0(t);t!==null;){if(n=t[cn])return n;t=c0(t)}return e}t=n,n=t.parentNode}return null}function Pa(t){if(t=t[cn]||t[Ia]){var e=t.tag;if(e===5||e===6||e===13||e===26||e===27||e===3)return t}return null}function Co(t){var e=t.tag;if(e===5||e===26||e===27||e===6)return t.stateNode;throw Error(Q(33))}function pa(t){var e=t[tv];return e||(e=t[tv]={hoistableStyles:new Map,hoistableScripts:new Map}),e}function $t(t){t[ll]=!0}var P0=new Set,L0={};function Sr(t,e){Ma(t,e),Ma(t+"Capture",e)}function Ma(t,e){for(L0[t]=e,t=0;t<e.length;t++)P0.add(e[t])}var ZS=RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"),nv={},iv={};function KS(t){return dd.call(iv,t)?!0:dd.call(nv,t)?!1:ZS.test(t)?iv[t]=!0:(nv[t]=!0,!1)}function _c(t,e,n){if(KS(e))if(n===null)t.removeAttribute(e);else{switch(typeof n){case"undefined":case"function":case"symbol":t.removeAttribute(e);return;case"boolean":var i=e.toLowerCase().slice(0,5);if(i!=="data-"&&i!=="aria-"){t.removeAttribute(e);return}}t.setAttribute(e,""+n)}}function ac(t,e,n){if(n===null)t.removeAttribute(e);else{switch(typeof n){case"undefined":case"function":case"symbol":case"boolean":t.removeAttribute(e);return}t.setAttribute(e,""+n)}}function Hi(t,e,n,i){if(i===null)t.removeAttribute(n);else{switch(typeof i){case"undefined":case"function":case"symbol":case"boolean":t.removeAttribute(n);return}t.setAttributeNS(e,n,""+i)}}var Uh,sv;function $r(t){if(Uh===void 0)try{throw Error()}catch(n){var e=n.stack.trim().match(/\n( *(at )?)/);Uh=e&&e[1]||"",sv=-1<n.stack.indexOf(`
    at`)?" (<anonymous>)":-1<n.stack.indexOf("@")?"@unknown:0:0":""}return`
`+Uh+t+sv}var Bh=!1;function Ih(t,e){if(!t||Bh)return"";Bh=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{var i={DetermineComponentFrameRoot:function(){try{if(e){var p=function(){throw Error()};if(Object.defineProperty(p.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(p,[])}catch(d){var h=d}Reflect.construct(t,[],p)}else{try{p.call()}catch(d){h=d}t.call(p.prototype)}}else{try{throw Error()}catch(d){h=d}(p=t())&&typeof p.catch=="function"&&p.catch(function(){})}}catch(d){if(d&&h&&typeof d.stack=="string")return[d.stack,h.stack]}return[null,null]}};i.DetermineComponentFrameRoot.displayName="DetermineComponentFrameRoot";var s=Object.getOwnPropertyDescriptor(i.DetermineComponentFrameRoot,"name");s&&s.configurable&&Object.defineProperty(i.DetermineComponentFrameRoot,"name",{value:"DetermineComponentFrameRoot"});var r=i.DetermineComponentFrameRoot(),a=r[0],o=r[1];if(a&&o){var l=a.split(`
`),c=o.split(`
`);for(s=i=0;i<l.length&&!l[i].includes("DetermineComponentFrameRoot");)i++;for(;s<c.length&&!c[s].includes("DetermineComponentFrameRoot");)s++;if(i===l.length||s===c.length)for(i=l.length-1,s=c.length-1;1<=i&&0<=s&&l[i]!==c[s];)s--;for(;1<=i&&0<=s;i--,s--)if(l[i]!==c[s]){if(i!==1||s!==1)do if(i--,s--,0>s||l[i]!==c[s]){var f=`
`+l[i].replace(" at new "," at ");return t.displayName&&f.includes("<anonymous>")&&(f=f.replace("<anonymous>",t.displayName)),f}while(1<=i&&0<=s);break}}}finally{Bh=!1,Error.prepareStackTrace=n}return(n=t?t.displayName||t.name:"")?$r(n):""}function JS(t){switch(t.tag){case 26:case 27:case 5:return $r(t.type);case 16:return $r("Lazy");case 13:return $r("Suspense");case 19:return $r("SuspenseList");case 0:case 15:return Ih(t.type,!1);case 11:return Ih(t.type.render,!1);case 1:return Ih(t.type,!0);case 31:return $r("Activity");default:return""}}function rv(t){try{var e="";do e+=JS(t),t=t.return;while(t);return e}catch(n){return`
Error generating stack: `+n.message+`
`+n.stack}}function Jn(t){switch(typeof t){case"bigint":case"boolean":case"number":case"string":case"undefined":return t;case"object":return t;default:return""}}function N0(t){var e=t.type;return(t=t.nodeName)&&t.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function jS(t){var e=N0(t)?"checked":"value",n=Object.getOwnPropertyDescriptor(t.constructor.prototype,e),i=""+t[e];if(!t.hasOwnProperty(e)&&typeof n<"u"&&typeof n.get=="function"&&typeof n.set=="function"){var s=n.get,r=n.set;return Object.defineProperty(t,e,{configurable:!0,get:function(){return s.call(this)},set:function(a){i=""+a,r.call(this,a)}}),Object.defineProperty(t,e,{enumerable:n.enumerable}),{getValue:function(){return i},setValue:function(a){i=""+a},stopTracking:function(){t._valueTracker=null,delete t[e]}}}}function Oc(t){t._valueTracker||(t._valueTracker=jS(t))}function O0(t){if(!t)return!1;var e=t._valueTracker;if(!e)return!0;var n=e.getValue(),i="";return t&&(i=N0(t)?t.checked?"true":"false":t.value),t=i,t!==n?(e.setValue(t),!0):!1}function Fc(t){if(t=t||(typeof document<"u"?document:void 0),typeof t>"u")return null;try{return t.activeElement||t.body}catch{return t.body}}var $S=/[\n"\\]/g;function ei(t){return t.replace($S,function(e){return"\\"+e.charCodeAt(0).toString(16)+" "})}function md(t,e,n,i,s,r,a,o){t.name="",a!=null&&typeof a!="function"&&typeof a!="symbol"&&typeof a!="boolean"?t.type=a:t.removeAttribute("type"),e!=null?a==="number"?(e===0&&t.value===""||t.value!=e)&&(t.value=""+Jn(e)):t.value!==""+Jn(e)&&(t.value=""+Jn(e)):a!=="submit"&&a!=="reset"||t.removeAttribute("value"),e!=null?gd(t,a,Jn(e)):n!=null?gd(t,a,Jn(n)):i!=null&&t.removeAttribute("value"),s==null&&r!=null&&(t.defaultChecked=!!r),s!=null&&(t.checked=s&&typeof s!="function"&&typeof s!="symbol"),o!=null&&typeof o!="function"&&typeof o!="symbol"&&typeof o!="boolean"?t.name=""+Jn(o):t.removeAttribute("name")}function F0(t,e,n,i,s,r,a,o){if(r!=null&&typeof r!="function"&&typeof r!="symbol"&&typeof r!="boolean"&&(t.type=r),e!=null||n!=null){if(!(r!=="submit"&&r!=="reset"||e!=null))return;n=n!=null?""+Jn(n):"",e=e!=null?""+Jn(e):n,o||e===t.value||(t.value=e),t.defaultValue=e}i=i??s,i=typeof i!="function"&&typeof i!="symbol"&&!!i,t.checked=o?t.checked:!!i,t.defaultChecked=!!i,a!=null&&typeof a!="function"&&typeof a!="symbol"&&typeof a!="boolean"&&(t.name=a)}function gd(t,e,n){e==="number"&&Fc(t.ownerDocument)===t||t.defaultValue===""+n||(t.defaultValue=""+n)}function ma(t,e,n,i){if(t=t.options,e){e={};for(var s=0;s<n.length;s++)e["$"+n[s]]=!0;for(n=0;n<t.length;n++)s=e.hasOwnProperty("$"+t[n].value),t[n].selected!==s&&(t[n].selected=s),s&&i&&(t[n].defaultSelected=!0)}else{for(n=""+Jn(n),e=null,s=0;s<t.length;s++){if(t[s].value===n){t[s].selected=!0,i&&(t[s].defaultSelected=!0);return}e!==null||t[s].disabled||(e=t[s])}e!==null&&(e.selected=!0)}}function z0(t,e,n){if(e!=null&&(e=""+Jn(e),e!==t.value&&(t.value=e),n==null)){t.defaultValue!==e&&(t.defaultValue=e);return}t.defaultValue=n!=null?""+Jn(n):""}function H0(t,e,n,i){if(e==null){if(i!=null){if(n!=null)throw Error(Q(92));if(wo(i)){if(1<i.length)throw Error(Q(93));i=i[0]}n=i}n==null&&(n=""),e=n}n=Jn(e),t.defaultValue=n,i=t.textContent,i===n&&i!==""&&i!==null&&(t.value=i)}function Ea(t,e){if(e){var n=t.firstChild;if(n&&n===t.lastChild&&n.nodeType===3){n.nodeValue=e;return}}t.textContent=e}var e1=new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));function av(t,e,n){var i=e.indexOf("--")===0;n==null||typeof n=="boolean"||n===""?i?t.setProperty(e,""):e==="float"?t.cssFloat="":t[e]="":i?t.setProperty(e,n):typeof n!="number"||n===0||e1.has(e)?e==="float"?t.cssFloat=n:t[e]=(""+n).trim():t[e]=n+"px"}function G0(t,e,n){if(e!=null&&typeof e!="object")throw Error(Q(62));if(t=t.style,n!=null){for(var i in n)!n.hasOwnProperty(i)||e!=null&&e.hasOwnProperty(i)||(i.indexOf("--")===0?t.setProperty(i,""):i==="float"?t.cssFloat="":t[i]="");for(var s in e)i=e[s],e.hasOwnProperty(s)&&n[s]!==i&&av(t,s,i)}else for(var r in e)e.hasOwnProperty(r)&&av(t,r,e[r])}function op(t){if(t.indexOf("-")===-1)return!1;switch(t){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var t1=new Map([["acceptCharset","accept-charset"],["htmlFor","for"],["httpEquiv","http-equiv"],["crossOrigin","crossorigin"],["accentHeight","accent-height"],["alignmentBaseline","alignment-baseline"],["arabicForm","arabic-form"],["baselineShift","baseline-shift"],["capHeight","cap-height"],["clipPath","clip-path"],["clipRule","clip-rule"],["colorInterpolation","color-interpolation"],["colorInterpolationFilters","color-interpolation-filters"],["colorProfile","color-profile"],["colorRendering","color-rendering"],["dominantBaseline","dominant-baseline"],["enableBackground","enable-background"],["fillOpacity","fill-opacity"],["fillRule","fill-rule"],["floodColor","flood-color"],["floodOpacity","flood-opacity"],["fontFamily","font-family"],["fontSize","font-size"],["fontSizeAdjust","font-size-adjust"],["fontStretch","font-stretch"],["fontStyle","font-style"],["fontVariant","font-variant"],["fontWeight","font-weight"],["glyphName","glyph-name"],["glyphOrientationHorizontal","glyph-orientation-horizontal"],["glyphOrientationVertical","glyph-orientation-vertical"],["horizAdvX","horiz-adv-x"],["horizOriginX","horiz-origin-x"],["imageRendering","image-rendering"],["letterSpacing","letter-spacing"],["lightingColor","lighting-color"],["markerEnd","marker-end"],["markerMid","marker-mid"],["markerStart","marker-start"],["overlinePosition","overline-position"],["overlineThickness","overline-thickness"],["paintOrder","paint-order"],["panose-1","panose-1"],["pointerEvents","pointer-events"],["renderingIntent","rendering-intent"],["shapeRendering","shape-rendering"],["stopColor","stop-color"],["stopOpacity","stop-opacity"],["strikethroughPosition","strikethrough-position"],["strikethroughThickness","strikethrough-thickness"],["strokeDasharray","stroke-dasharray"],["strokeDashoffset","stroke-dashoffset"],["strokeLinecap","stroke-linecap"],["strokeLinejoin","stroke-linejoin"],["strokeMiterlimit","stroke-miterlimit"],["strokeOpacity","stroke-opacity"],["strokeWidth","stroke-width"],["textAnchor","text-anchor"],["textDecoration","text-decoration"],["textRendering","text-rendering"],["transformOrigin","transform-origin"],["underlinePosition","underline-position"],["underlineThickness","underline-thickness"],["unicodeBidi","unicode-bidi"],["unicodeRange","unicode-range"],["unitsPerEm","units-per-em"],["vAlphabetic","v-alphabetic"],["vHanging","v-hanging"],["vIdeographic","v-ideographic"],["vMathematical","v-mathematical"],["vectorEffect","vector-effect"],["vertAdvY","vert-adv-y"],["vertOriginX","vert-origin-x"],["vertOriginY","vert-origin-y"],["wordSpacing","word-spacing"],["writingMode","writing-mode"],["xmlnsXlink","xmlns:xlink"],["xHeight","x-height"]]),n1=/^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;function Ac(t){return n1.test(""+t)?"javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')":t}var vd=null;function lp(t){return t=t.target||t.srcElement||window,t.correspondingUseElement&&(t=t.correspondingUseElement),t.nodeType===3?t.parentNode:t}var ra=null,ga=null;function ov(t){var e=Pa(t);if(e&&(t=e.stateNode)){var n=t[wn]||null;e:switch(t=e.stateNode,e.type){case"input":if(md(t,n.value,n.defaultValue,n.defaultValue,n.checked,n.defaultChecked,n.type,n.name),e=n.name,n.type==="radio"&&e!=null){for(n=t;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll('input[name="'+ei(""+e)+'"][type="radio"]'),e=0;e<n.length;e++){var i=n[e];if(i!==t&&i.form===t.form){var s=i[wn]||null;if(!s)throw Error(Q(90));md(i,s.value,s.defaultValue,s.defaultValue,s.checked,s.defaultChecked,s.type,s.name)}}for(e=0;e<n.length;e++)i=n[e],i.form===t.form&&O0(i)}break e;case"textarea":z0(t,n.value,n.defaultValue);break e;case"select":e=n.value,e!=null&&ma(t,!!n.multiple,e,!1)}}}var Ph=!1;function k0(t,e,n){if(Ph)return t(e,n);Ph=!0;try{var i=t(e);return i}finally{if(Ph=!1,(ra!==null||ga!==null)&&(yu(),ra&&(e=ra,t=ga,ga=ra=null,ov(e),t)))for(e=0;e<t.length;e++)ov(t[e])}}function Xo(t,e){var n=t.stateNode;if(n===null)return null;var i=n[wn]||null;if(i===null)return null;n=i[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(t=t.type,i=!(t==="button"||t==="input"||t==="select"||t==="textarea")),t=!i;break e;default:t=!1}if(t)return null;if(n&&typeof n!="function")throw Error(Q(231,e,typeof n));return n}var Ji=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),xd=!1;if(Ji)try{Kr={},Object.defineProperty(Kr,"passive",{get:function(){xd=!0}}),window.addEventListener("test",Kr,Kr),window.removeEventListener("test",Kr,Kr)}catch{xd=!1}var Kr,Ss=null,cp=null,Sc=null;function V0(){if(Sc)return Sc;var t,e=cp,n=e.length,i,s="value"in Ss?Ss.value:Ss.textContent,r=s.length;for(t=0;t<n&&e[t]===s[t];t++);var a=n-t;for(i=1;i<=a&&e[n-i]===s[r-i];i++);return Sc=s.slice(t,1<i?1-i:void 0)}function Mc(t){var e=t.keyCode;return"charCode"in t?(t=t.charCode,t===0&&e===13&&(t=13)):t=e,t===10&&(t=13),32<=t||t===13?t:0}function oc(){return!0}function lv(){return!1}function Cn(t){function e(n,i,s,r,a){this._reactName=n,this._targetInst=s,this.type=i,this.nativeEvent=r,this.target=a,this.currentTarget=null;for(var o in t)t.hasOwnProperty(o)&&(n=t[o],this[o]=n?n(r):r[o]);return this.isDefaultPrevented=(r.defaultPrevented!=null?r.defaultPrevented:r.returnValue===!1)?oc:lv,this.isPropagationStopped=lv,this}return yt(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var n=this.nativeEvent;n&&(n.preventDefault?n.preventDefault():typeof n.returnValue!="unknown"&&(n.returnValue=!1),this.isDefaultPrevented=oc)},stopPropagation:function(){var n=this.nativeEvent;n&&(n.stopPropagation?n.stopPropagation():typeof n.cancelBubble!="unknown"&&(n.cancelBubble=!0),this.isPropagationStopped=oc)},persist:function(){},isPersistent:oc}),e}var Mr={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(t){return t.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},uu=Cn(Mr),cl=yt({},Mr,{view:0,detail:0}),i1=Cn(cl),Lh,Nh,yo,fu=yt({},cl,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:up,button:0,buttons:0,relatedTarget:function(t){return t.relatedTarget===void 0?t.fromElement===t.srcElement?t.toElement:t.fromElement:t.relatedTarget},movementX:function(t){return"movementX"in t?t.movementX:(t!==yo&&(yo&&t.type==="mousemove"?(Lh=t.screenX-yo.screenX,Nh=t.screenY-yo.screenY):Nh=Lh=0,yo=t),Lh)},movementY:function(t){return"movementY"in t?t.movementY:Nh}}),cv=Cn(fu),s1=yt({},fu,{dataTransfer:0}),r1=Cn(s1),a1=yt({},cl,{relatedTarget:0}),Oh=Cn(a1),o1=yt({},Mr,{animationName:0,elapsedTime:0,pseudoElement:0}),l1=Cn(o1),c1=yt({},Mr,{clipboardData:function(t){return"clipboardData"in t?t.clipboardData:window.clipboardData}}),u1=Cn(c1),f1=yt({},Mr,{data:0}),uv=Cn(f1),h1={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},d1={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},p1={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function m1(t){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(t):(t=p1[t])?!!e[t]:!1}function up(){return m1}var g1=yt({},cl,{key:function(t){if(t.key){var e=h1[t.key]||t.key;if(e!=="Unidentified")return e}return t.type==="keypress"?(t=Mc(t),t===13?"Enter":String.fromCharCode(t)):t.type==="keydown"||t.type==="keyup"?d1[t.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:up,charCode:function(t){return t.type==="keypress"?Mc(t):0},keyCode:function(t){return t.type==="keydown"||t.type==="keyup"?t.keyCode:0},which:function(t){return t.type==="keypress"?Mc(t):t.type==="keydown"||t.type==="keyup"?t.keyCode:0}}),v1=Cn(g1),x1=yt({},fu,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),fv=Cn(x1),y1=yt({},cl,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:up}),_1=Cn(y1),A1=yt({},Mr,{propertyName:0,elapsedTime:0,pseudoElement:0}),S1=Cn(A1),M1=yt({},fu,{deltaX:function(t){return"deltaX"in t?t.deltaX:"wheelDeltaX"in t?-t.wheelDeltaX:0},deltaY:function(t){return"deltaY"in t?t.deltaY:"wheelDeltaY"in t?-t.wheelDeltaY:"wheelDelta"in t?-t.wheelDelta:0},deltaZ:0,deltaMode:0}),E1=Cn(M1),T1=yt({},Mr,{newState:0,oldState:0}),b1=Cn(T1),w1=[9,13,27,32],fp=Ji&&"CompositionEvent"in window,Do=null;Ji&&"documentMode"in document&&(Do=document.documentMode);var C1=Ji&&"TextEvent"in window&&!Do,W0=Ji&&(!fp||Do&&8<Do&&11>=Do),hv=" ",dv=!1;function X0(t,e){switch(t){case"keyup":return w1.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function Y0(t){return t=t.detail,typeof t=="object"&&"data"in t?t.data:null}var aa=!1;function R1(t,e){switch(t){case"compositionend":return Y0(e);case"keypress":return e.which!==32?null:(dv=!0,hv);case"textInput":return t=e.data,t===hv&&dv?null:t;default:return null}}function D1(t,e){if(aa)return t==="compositionend"||!fp&&X0(t,e)?(t=V0(),Sc=cp=Ss=null,aa=!1,t):null;switch(t){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return W0&&e.locale!=="ko"?null:e.data;default:return null}}var U1={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function pv(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e==="input"?!!U1[t.type]:e==="textarea"}function q0(t,e,n,i){ra?ga?ga.push(i):ga=[i]:ra=i,e=nu(e,"onChange"),0<e.length&&(n=new uu("onChange","change",null,n,i),t.push({event:n,listeners:e}))}var Uo=null,Yo=null;function B1(t){zy(t,0)}function hu(t){var e=Co(t);if(O0(e))return t}function mv(t,e){if(t==="change")return e}var Q0=!1;Ji&&(Ji?(cc="oninput"in document,cc||(Fh=document.createElement("div"),Fh.setAttribute("oninput","return;"),cc=typeof Fh.oninput=="function"),lc=cc):lc=!1,Q0=lc&&(!document.documentMode||9<document.documentMode));var lc,cc,Fh;function gv(){Uo&&(Uo.detachEvent("onpropertychange",Z0),Yo=Uo=null)}function Z0(t){if(t.propertyName==="value"&&hu(Yo)){var e=[];q0(e,Yo,t,lp(t)),k0(B1,e)}}function I1(t,e,n){t==="focusin"?(gv(),Uo=e,Yo=n,Uo.attachEvent("onpropertychange",Z0)):t==="focusout"&&gv()}function P1(t){if(t==="selectionchange"||t==="keyup"||t==="keydown")return hu(Yo)}function L1(t,e){if(t==="click")return hu(e)}function N1(t,e){if(t==="input"||t==="change")return hu(e)}function O1(t,e){return t===e&&(t!==0||1/t===1/e)||t!==t&&e!==e}var Hn=typeof Object.is=="function"?Object.is:O1;function qo(t,e){if(Hn(t,e))return!0;if(typeof t!="object"||t===null||typeof e!="object"||e===null)return!1;var n=Object.keys(t),i=Object.keys(e);if(n.length!==i.length)return!1;for(i=0;i<n.length;i++){var s=n[i];if(!dd.call(e,s)||!Hn(t[s],e[s]))return!1}return!0}function vv(t){for(;t&&t.firstChild;)t=t.firstChild;return t}function xv(t,e){var n=vv(t);t=0;for(var i;n;){if(n.nodeType===3){if(i=t+n.textContent.length,t<=e&&i>=e)return{node:n,offset:e-t};t=i}e:{for(;n;){if(n.nextSibling){n=n.nextSibling;break e}n=n.parentNode}n=void 0}n=vv(n)}}function K0(t,e){return t&&e?t===e?!0:t&&t.nodeType===3?!1:e&&e.nodeType===3?K0(t,e.parentNode):"contains"in t?t.contains(e):t.compareDocumentPosition?!!(t.compareDocumentPosition(e)&16):!1:!1}function J0(t){t=t!=null&&t.ownerDocument!=null&&t.ownerDocument.defaultView!=null?t.ownerDocument.defaultView:window;for(var e=Fc(t.document);e instanceof t.HTMLIFrameElement;){try{var n=typeof e.contentWindow.location.href=="string"}catch{n=!1}if(n)t=e.contentWindow;else break;e=Fc(t.document)}return e}function hp(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e&&(e==="input"&&(t.type==="text"||t.type==="search"||t.type==="tel"||t.type==="url"||t.type==="password")||e==="textarea"||t.contentEditable==="true")}var F1=Ji&&"documentMode"in document&&11>=document.documentMode,oa=null,yd=null,Bo=null,_d=!1;function yv(t,e,n){var i=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;_d||oa==null||oa!==Fc(i)||(i=oa,"selectionStart"in i&&hp(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),Bo&&qo(Bo,i)||(Bo=i,i=nu(yd,"onSelect"),0<i.length&&(e=new uu("onSelect","select",null,e,n),t.push({event:e,listeners:i}),e.target=oa)))}function or(t,e){var n={};return n[t.toLowerCase()]=e.toLowerCase(),n["Webkit"+t]="webkit"+e,n["Moz"+t]="moz"+e,n}var la={animationend:or("Animation","AnimationEnd"),animationiteration:or("Animation","AnimationIteration"),animationstart:or("Animation","AnimationStart"),transitionrun:or("Transition","TransitionRun"),transitionstart:or("Transition","TransitionStart"),transitioncancel:or("Transition","TransitionCancel"),transitionend:or("Transition","TransitionEnd")},zh={},j0={};Ji&&(j0=document.createElement("div").style,"AnimationEvent"in window||(delete la.animationend.animation,delete la.animationiteration.animation,delete la.animationstart.animation),"TransitionEvent"in window||delete la.transitionend.transition);function Er(t){if(zh[t])return zh[t];if(!la[t])return t;var e=la[t],n;for(n in e)if(e.hasOwnProperty(n)&&n in j0)return zh[t]=e[n];return t}var $0=Er("animationend"),ex=Er("animationiteration"),tx=Er("animationstart"),z1=Er("transitionrun"),H1=Er("transitionstart"),G1=Er("transitioncancel"),nx=Er("transitionend"),ix=new Map,Ad="abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");Ad.push("scrollEnd");function hi(t,e){ix.set(t,e),Sr(e,[t])}var _v=new WeakMap;function ti(t,e){if(typeof t=="object"&&t!==null){var n=_v.get(t);return n!==void 0?n:(e={value:t,source:e,stack:rv(e)},_v.set(t,e),e)}return{value:t,source:e,stack:rv(e)}}var Kn=[],ca=0,dp=0;function du(){for(var t=ca,e=dp=ca=0;e<t;){var n=Kn[e];Kn[e++]=null;var i=Kn[e];Kn[e++]=null;var s=Kn[e];Kn[e++]=null;var r=Kn[e];if(Kn[e++]=null,i!==null&&s!==null){var a=i.pending;a===null?s.next=s:(s.next=a.next,a.next=s),i.pending=s}r!==0&&sx(n,s,r)}}function pu(t,e,n,i){Kn[ca++]=t,Kn[ca++]=e,Kn[ca++]=n,Kn[ca++]=i,dp|=i,t.lanes|=i,t=t.alternate,t!==null&&(t.lanes|=i)}function pp(t,e,n,i){return pu(t,e,n,i),zc(t)}function La(t,e){return pu(t,null,null,e),zc(t)}function sx(t,e,n){t.lanes|=n;var i=t.alternate;i!==null&&(i.lanes|=n);for(var s=!1,r=t.return;r!==null;)r.childLanes|=n,i=r.alternate,i!==null&&(i.childLanes|=n),r.tag===22&&(t=r.stateNode,t===null||t._visibility&1||(s=!0)),t=r,r=r.return;return t.tag===3?(r=t.stateNode,s&&e!==null&&(s=31-On(n),t=r.hiddenUpdates,i=t[s],i===null?t[s]=[e]:i.push(e),e.lane=n|536870912),r):null}function zc(t){if(50<ko)throw ko=0,kd=null,Error(Q(185));for(var e=t.return;e!==null;)t=e,e=t.return;return t.tag===3?t.stateNode:null}var ua={};function k1(t,e,n,i){this.tag=t,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.refCleanup=this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Ln(t,e,n,i){return new k1(t,e,n,i)}function mp(t){return t=t.prototype,!(!t||!t.isReactComponent)}function Zi(t,e){var n=t.alternate;return n===null?(n=Ln(t.tag,e,t.key,t.mode),n.elementType=t.elementType,n.type=t.type,n.stateNode=t.stateNode,n.alternate=t,t.alternate=n):(n.pendingProps=e,n.type=t.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=t.flags&65011712,n.childLanes=t.childLanes,n.lanes=t.lanes,n.child=t.child,n.memoizedProps=t.memoizedProps,n.memoizedState=t.memoizedState,n.updateQueue=t.updateQueue,e=t.dependencies,n.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},n.sibling=t.sibling,n.index=t.index,n.ref=t.ref,n.refCleanup=t.refCleanup,n}function rx(t,e){t.flags&=65011714;var n=t.alternate;return n===null?(t.childLanes=0,t.lanes=e,t.child=null,t.subtreeFlags=0,t.memoizedProps=null,t.memoizedState=null,t.updateQueue=null,t.dependencies=null,t.stateNode=null):(t.childLanes=n.childLanes,t.lanes=n.lanes,t.child=n.child,t.subtreeFlags=0,t.deletions=null,t.memoizedProps=n.memoizedProps,t.memoizedState=n.memoizedState,t.updateQueue=n.updateQueue,t.type=n.type,e=n.dependencies,t.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext}),t}function Ec(t,e,n,i,s,r){var a=0;if(i=t,typeof t=="function")mp(t)&&(a=1);else if(typeof t=="string")a=kM(t,n,bi.current)?26:t==="html"||t==="head"||t==="body"?27:5;else e:switch(t){case cd:return t=Ln(31,n,e,s),t.elementType=cd,t.lanes=r,t;case na:return hr(n.children,s,r,e);case E0:a=8,s|=24;break;case ad:return t=Ln(12,n,e,s|2),t.elementType=ad,t.lanes=r,t;case od:return t=Ln(13,n,e,s),t.elementType=od,t.lanes=r,t;case ld:return t=Ln(19,n,e,s),t.elementType=ld,t.lanes=r,t;default:if(typeof t=="object"&&t!==null)switch(t.$$typeof){case BS:case Wi:a=10;break e;case T0:a=9;break e;case tp:a=11;break e;case np:a=14;break e;case ms:a=16,i=null;break e}a=29,n=Error(Q(130,t===null?"null":typeof t,"")),i=null}return e=Ln(a,n,e,s),e.elementType=t,e.type=i,e.lanes=r,e}function hr(t,e,n,i){return t=Ln(7,t,i,e),t.lanes=n,t}function Hh(t,e,n){return t=Ln(6,t,null,e),t.lanes=n,t}function Gh(t,e,n){return e=Ln(4,t.children!==null?t.children:[],t.key,e),e.lanes=n,e.stateNode={containerInfo:t.containerInfo,pendingChildren:null,implementation:t.implementation},e}var fa=[],ha=0,Hc=null,Gc=0,jn=[],$n=0,dr=null,Xi=1,Yi="";function cr(t,e){fa[ha++]=Gc,fa[ha++]=Hc,Hc=t,Gc=e}function ax(t,e,n){jn[$n++]=Xi,jn[$n++]=Yi,jn[$n++]=dr,dr=t;var i=Xi;t=Yi;var s=32-On(i)-1;i&=~(1<<s),n+=1;var r=32-On(e)+s;if(30<r){var a=s-s%5;r=(i&(1<<a)-1).toString(32),i>>=a,s-=a,Xi=1<<32-On(e)+s|n<<s|i,Yi=r+t}else Xi=1<<r|n<<s|i,Yi=t}function gp(t){t.return!==null&&(cr(t,1),ax(t,1,0))}function vp(t){for(;t===Hc;)Hc=fa[--ha],fa[ha]=null,Gc=fa[--ha],fa[ha]=null;for(;t===dr;)dr=jn[--$n],jn[$n]=null,Yi=jn[--$n],jn[$n]=null,Xi=jn[--$n],jn[$n]=null}var An=null,Dt=null,nt=!1,pr=null,Ei=!1,Sd=Error(Q(519));function xr(t){var e=Error(Q(418,""));throw Qo(ti(e,t)),Sd}function Av(t){var e=t.stateNode,n=t.type,i=t.memoizedProps;switch(e[cn]=t,e[wn]=i,n){case"dialog":Ve("cancel",e),Ve("close",e);break;case"iframe":case"object":case"embed":Ve("load",e);break;case"video":case"audio":for(n=0;n<Jo.length;n++)Ve(Jo[n],e);break;case"source":Ve("error",e);break;case"img":case"image":case"link":Ve("error",e),Ve("load",e);break;case"details":Ve("toggle",e);break;case"input":Ve("invalid",e),F0(e,i.value,i.defaultValue,i.checked,i.defaultChecked,i.type,i.name,!0),Oc(e);break;case"select":Ve("invalid",e);break;case"textarea":Ve("invalid",e),H0(e,i.value,i.defaultValue,i.children),Oc(e)}n=i.children,typeof n!="string"&&typeof n!="number"&&typeof n!="bigint"||e.textContent===""+n||i.suppressHydrationWarning===!0||Gy(e.textContent,n)?(i.popover!=null&&(Ve("beforetoggle",e),Ve("toggle",e)),i.onScroll!=null&&Ve("scroll",e),i.onScrollEnd!=null&&Ve("scrollend",e),i.onClick!=null&&(e.onclick=Su),e=!0):e=!1,e||xr(t)}function Sv(t){for(An=t.return;An;)switch(An.tag){case 5:case 13:Ei=!1;return;case 27:case 3:Ei=!0;return;default:An=An.return}}function _o(t){if(t!==An)return!1;if(!nt)return Sv(t),nt=!0,!1;var e=t.tag,n;if((n=e!==3&&e!==27)&&((n=e===5)&&(n=t.type,n=!(n!=="form"&&n!=="button")||Qd(t.type,t.memoizedProps)),n=!n),n&&Dt&&xr(t),Sv(t),e===13){if(t=t.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(Q(317));e:{for(t=t.nextSibling,e=0;t;){if(t.nodeType===8)if(n=t.data,n==="/$"){if(e===0){Dt=fi(t.nextSibling);break e}e--}else n!=="$"&&n!=="$!"&&n!=="$?"||e++;t=t.nextSibling}Dt=null}}else e===27?(e=Dt,Os(t.type)?(t=Jd,Jd=null,Dt=t):Dt=e):Dt=An?fi(t.stateNode.nextSibling):null;return!0}function ul(){Dt=An=null,nt=!1}function Mv(){var t=pr;return t!==null&&(bn===null?bn=t:bn.push.apply(bn,t),pr=null),t}function Qo(t){pr===null?pr=[t]:pr.push(t)}var Md=Ri(null),Tr=null,qi=null;function vs(t,e,n){Tt(Md,e._currentValue),e._currentValue=n}function Ki(t){t._currentValue=Md.current,tn(Md)}function Ed(t,e,n){for(;t!==null;){var i=t.alternate;if((t.childLanes&e)!==e?(t.childLanes|=e,i!==null&&(i.childLanes|=e)):i!==null&&(i.childLanes&e)!==e&&(i.childLanes|=e),t===n)break;t=t.return}}function Td(t,e,n,i){var s=t.child;for(s!==null&&(s.return=t);s!==null;){var r=s.dependencies;if(r!==null){var a=s.child;r=r.firstContext;e:for(;r!==null;){var o=r;r=s;for(var l=0;l<e.length;l++)if(o.context===e[l]){r.lanes|=n,o=r.alternate,o!==null&&(o.lanes|=n),Ed(r.return,n,t),i||(a=null);break e}r=o.next}}else if(s.tag===18){if(a=s.return,a===null)throw Error(Q(341));a.lanes|=n,r=a.alternate,r!==null&&(r.lanes|=n),Ed(a,n,t),a=null}else a=s.child;if(a!==null)a.return=s;else for(a=s;a!==null;){if(a===t){a=null;break}if(s=a.sibling,s!==null){s.return=a.return,a=s;break}a=a.return}s=a}}function fl(t,e,n,i){t=null;for(var s=e,r=!1;s!==null;){if(!r){if((s.flags&524288)!==0)r=!0;else if((s.flags&262144)!==0)break}if(s.tag===10){var a=s.alternate;if(a===null)throw Error(Q(387));if(a=a.memoizedProps,a!==null){var o=s.type;Hn(s.pendingProps.value,a.value)||(t!==null?t.push(o):t=[o])}}else if(s===Ic.current){if(a=s.alternate,a===null)throw Error(Q(387));a.memoizedState.memoizedState!==s.memoizedState.memoizedState&&(t!==null?t.push(el):t=[el])}s=s.return}t!==null&&Td(e,t,n,i),e.flags|=262144}function kc(t){for(t=t.firstContext;t!==null;){if(!Hn(t.context._currentValue,t.memoizedValue))return!0;t=t.next}return!1}function yr(t){Tr=t,qi=null,t=t.dependencies,t!==null&&(t.firstContext=null)}function un(t){return ox(Tr,t)}function uc(t,e){return Tr===null&&yr(t),ox(t,e)}function ox(t,e){var n=e._currentValue;if(e={context:e,memoizedValue:n,next:null},qi===null){if(t===null)throw Error(Q(308));qi=e,t.dependencies={lanes:0,firstContext:e},t.flags|=524288}else qi=qi.next=e;return n}var V1=typeof AbortController<"u"?AbortController:function(){var t=[],e=this.signal={aborted:!1,addEventListener:function(n,i){t.push(i)}};this.abort=function(){e.aborted=!0,t.forEach(function(n){return n()})}},W1=Wt.unstable_scheduleCallback,X1=Wt.unstable_NormalPriority,kt={$$typeof:Wi,Consumer:null,Provider:null,_currentValue:null,_currentValue2:null,_threadCount:0};function xp(){return{controller:new V1,data:new Map,refCount:0}}function hl(t){t.refCount--,t.refCount===0&&W1(X1,function(){t.controller.abort()})}var Io=null,bd=0,Ta=0,va=null;function Y1(t,e){if(Io===null){var n=Io=[];bd=0,Ta=Gp(),va={status:"pending",value:void 0,then:function(i){n.push(i)}}}return bd++,e.then(Ev,Ev),e}function Ev(){if(--bd===0&&Io!==null){va!==null&&(va.status="fulfilled");var t=Io;Io=null,Ta=0,va=null;for(var e=0;e<t.length;e++)(0,t[e])()}}function q1(t,e){var n=[],i={status:"pending",value:null,reason:null,then:function(s){n.push(s)}};return t.then(function(){i.status="fulfilled",i.value=e;for(var s=0;s<n.length;s++)(0,n[s])(e)},function(s){for(i.status="rejected",i.reason=s,s=0;s<n.length;s++)(0,n[s])(void 0)}),i}var Tv=De.S;De.S=function(t,e){typeof e=="object"&&e!==null&&typeof e.then=="function"&&Y1(t,e),Tv!==null&&Tv(t,e)};var mr=Ri(null);function yp(){var t=mr.current;return t!==null?t:gt.pooledCache}function Tc(t,e){e===null?Tt(mr,mr.current):Tt(mr,e.pool)}function lx(){var t=yp();return t===null?null:{parent:kt._currentValue,pool:t}}var dl=Error(Q(460)),cx=Error(Q(474)),mu=Error(Q(542)),wd={then:function(){}};function bv(t){return t=t.status,t==="fulfilled"||t==="rejected"}function fc(){}function ux(t,e,n){switch(n=t[n],n===void 0?t.push(e):n!==e&&(e.then(fc,fc),e=n),e.status){case"fulfilled":return e.value;case"rejected":throw t=e.reason,Cv(t),t;default:if(typeof e.status=="string")e.then(fc,fc);else{if(t=gt,t!==null&&100<t.shellSuspendCounter)throw Error(Q(482));t=e,t.status="pending",t.then(function(i){if(e.status==="pending"){var s=e;s.status="fulfilled",s.value=i}},function(i){if(e.status==="pending"){var s=e;s.status="rejected",s.reason=i}})}switch(e.status){case"fulfilled":return e.value;case"rejected":throw t=e.reason,Cv(t),t}throw Po=e,dl}}var Po=null;function wv(){if(Po===null)throw Error(Q(459));var t=Po;return Po=null,t}function Cv(t){if(t===dl||t===mu)throw Error(Q(483))}var gs=!1;function _p(t){t.updateQueue={baseState:t.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,lanes:0,hiddenCallbacks:null},callbacks:null}}function Cd(t,e){t=t.updateQueue,e.updateQueue===t&&(e.updateQueue={baseState:t.baseState,firstBaseUpdate:t.firstBaseUpdate,lastBaseUpdate:t.lastBaseUpdate,shared:t.shared,callbacks:null})}function bs(t){return{lane:t,tag:0,payload:null,callback:null,next:null}}function ws(t,e,n){var i=t.updateQueue;if(i===null)return null;if(i=i.shared,(ot&2)!==0){var s=i.pending;return s===null?e.next=e:(e.next=s.next,s.next=e),i.pending=e,e=zc(t),sx(t,null,n),e}return pu(t,i,e,n),zc(t)}function Lo(t,e,n){if(e=e.updateQueue,e!==null&&(e=e.shared,(n&4194048)!==0)){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,B0(t,n)}}function kh(t,e){var n=t.updateQueue,i=t.alternate;if(i!==null&&(i=i.updateQueue,n===i)){var s=null,r=null;if(n=n.firstBaseUpdate,n!==null){do{var a={lane:n.lane,tag:n.tag,payload:n.payload,callback:null,next:null};r===null?s=r=a:r=r.next=a,n=n.next}while(n!==null);r===null?s=r=e:r=r.next=e}else s=r=e;n={baseState:i.baseState,firstBaseUpdate:s,lastBaseUpdate:r,shared:i.shared,callbacks:i.callbacks},t.updateQueue=n;return}t=n.lastBaseUpdate,t===null?n.firstBaseUpdate=e:t.next=e,n.lastBaseUpdate=e}var Rd=!1;function No(){if(Rd){var t=va;if(t!==null)throw t}}function Oo(t,e,n,i){Rd=!1;var s=t.updateQueue;gs=!1;var r=s.firstBaseUpdate,a=s.lastBaseUpdate,o=s.shared.pending;if(o!==null){s.shared.pending=null;var l=o,c=l.next;l.next=null,a===null?r=c:a.next=c,a=l;var f=t.alternate;f!==null&&(f=f.updateQueue,o=f.lastBaseUpdate,o!==a&&(o===null?f.firstBaseUpdate=c:o.next=c,f.lastBaseUpdate=l))}if(r!==null){var p=s.baseState;a=0,f=c=l=null,o=r;do{var h=o.lane&-536870913,d=h!==o.lane;if(d?(Ke&h)===h:(i&h)===h){h!==0&&h===Ta&&(Rd=!0),f!==null&&(f=f.next={lane:0,tag:o.tag,payload:o.payload,callback:null,next:null});e:{var y=t,_=o;h=e;var m=n;switch(_.tag){case 1:if(y=_.payload,typeof y=="function"){p=y.call(m,p,h);break e}p=y;break e;case 3:y.flags=y.flags&-65537|128;case 0:if(y=_.payload,h=typeof y=="function"?y.call(m,p,h):y,h==null)break e;p=yt({},p,h);break e;case 2:gs=!0}}h=o.callback,h!==null&&(t.flags|=64,d&&(t.flags|=8192),d=s.callbacks,d===null?s.callbacks=[h]:d.push(h))}else d={lane:h,tag:o.tag,payload:o.payload,callback:o.callback,next:null},f===null?(c=f=d,l=p):f=f.next=d,a|=h;if(o=o.next,o===null){if(o=s.shared.pending,o===null)break;d=o,o=d.next,d.next=null,s.lastBaseUpdate=d,s.shared.pending=null}}while(!0);f===null&&(l=p),s.baseState=l,s.firstBaseUpdate=c,s.lastBaseUpdate=f,r===null&&(s.shared.lanes=0),Ls|=a,t.lanes=a,t.memoizedState=p}}function fx(t,e){if(typeof t!="function")throw Error(Q(191,t));t.call(e)}function hx(t,e){var n=t.callbacks;if(n!==null)for(t.callbacks=null,t=0;t<n.length;t++)fx(n[t],e)}var ba=Ri(null),Vc=Ri(0);function Rv(t,e){t=es,Tt(Vc,t),Tt(ba,e),es=t|e.baseLanes}function Dd(){Tt(Vc,es),Tt(ba,ba.current)}function Ap(){es=Vc.current,tn(ba),tn(Vc)}var Is=0,Ge=null,ft=null,Ot=null,Wc=!1,xa=!1,_r=!1,Xc=0,Zo=0,ya=null,Q1=0;function Pt(){throw Error(Q(321))}function Sp(t,e){if(e===null)return!1;for(var n=0;n<e.length&&n<t.length;n++)if(!Hn(t[n],e[n]))return!1;return!0}function Mp(t,e,n,i,s,r){return Is=r,Ge=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,De.H=t===null||t.memoizedState===null?Vx:Wx,_r=!1,r=n(i,s),_r=!1,xa&&(r=px(e,n,i,s)),dx(t),r}function dx(t){De.H=Yc;var e=ft!==null&&ft.next!==null;if(Is=0,Ot=ft=Ge=null,Wc=!1,Zo=0,ya=null,e)throw Error(Q(300));t===null||en||(t=t.dependencies,t!==null&&kc(t)&&(en=!0))}function px(t,e,n,i){Ge=t;var s=0;do{if(xa&&(ya=null),Zo=0,xa=!1,25<=s)throw Error(Q(301));if(s+=1,Ot=ft=null,t.updateQueue!=null){var r=t.updateQueue;r.lastEffect=null,r.events=null,r.stores=null,r.memoCache!=null&&(r.memoCache.index=0)}De.H=tM,r=e(n,i)}while(xa);return r}function Z1(){var t=De.H,e=t.useState()[0];return e=typeof e.then=="function"?pl(e):e,t=t.useState()[0],(ft!==null?ft.memoizedState:null)!==t&&(Ge.flags|=1024),e}function Ep(){var t=Xc!==0;return Xc=0,t}function Tp(t,e,n){e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~n}function bp(t){if(Wc){for(t=t.memoizedState;t!==null;){var e=t.queue;e!==null&&(e.pending=null),t=t.next}Wc=!1}Is=0,Ot=ft=Ge=null,xa=!1,Zo=Xc=0,ya=null}function En(){var t={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return Ot===null?Ge.memoizedState=Ot=t:Ot=Ot.next=t,Ot}function Ft(){if(ft===null){var t=Ge.alternate;t=t!==null?t.memoizedState:null}else t=ft.next;var e=Ot===null?Ge.memoizedState:Ot.next;if(e!==null)Ot=e,ft=t;else{if(t===null)throw Ge.alternate===null?Error(Q(467)):Error(Q(310));ft=t,t={memoizedState:ft.memoizedState,baseState:ft.baseState,baseQueue:ft.baseQueue,queue:ft.queue,next:null},Ot===null?Ge.memoizedState=Ot=t:Ot=Ot.next=t}return Ot}function wp(){return{lastEffect:null,events:null,stores:null,memoCache:null}}function pl(t){var e=Zo;return Zo+=1,ya===null&&(ya=[]),t=ux(ya,t,e),e=Ge,(Ot===null?e.memoizedState:Ot.next)===null&&(e=e.alternate,De.H=e===null||e.memoizedState===null?Vx:Wx),t}function gu(t){if(t!==null&&typeof t=="object"){if(typeof t.then=="function")return pl(t);if(t.$$typeof===Wi)return un(t)}throw Error(Q(438,String(t)))}function Cp(t){var e=null,n=Ge.updateQueue;if(n!==null&&(e=n.memoCache),e==null){var i=Ge.alternate;i!==null&&(i=i.updateQueue,i!==null&&(i=i.memoCache,i!=null&&(e={data:i.data.map(function(s){return s.slice()}),index:0})))}if(e==null&&(e={data:[],index:0}),n===null&&(n=wp(),Ge.updateQueue=n),n.memoCache=e,n=e.data[e.index],n===void 0)for(n=e.data[e.index]=Array(t),i=0;i<t;i++)n[i]=IS;return e.index++,n}function ji(t,e){return typeof e=="function"?e(t):e}function bc(t){var e=Ft();return Rp(e,ft,t)}function Rp(t,e,n){var i=t.queue;if(i===null)throw Error(Q(311));i.lastRenderedReducer=n;var s=t.baseQueue,r=i.pending;if(r!==null){if(s!==null){var a=s.next;s.next=r.next,r.next=a}e.baseQueue=s=r,i.pending=null}if(r=t.baseState,s===null)t.memoizedState=r;else{e=s.next;var o=a=null,l=null,c=e,f=!1;do{var p=c.lane&-536870913;if(p!==c.lane?(Ke&p)===p:(Is&p)===p){var h=c.revertLane;if(h===0)l!==null&&(l=l.next={lane:0,revertLane:0,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}),p===Ta&&(f=!0);else if((Is&h)===h){c=c.next,h===Ta&&(f=!0);continue}else p={lane:0,revertLane:c.revertLane,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null},l===null?(o=l=p,a=r):l=l.next=p,Ge.lanes|=h,Ls|=h;p=c.action,_r&&n(r,p),r=c.hasEagerState?c.eagerState:n(r,p)}else h={lane:p,revertLane:c.revertLane,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null},l===null?(o=l=h,a=r):l=l.next=h,Ge.lanes|=p,Ls|=p;c=c.next}while(c!==null&&c!==e);if(l===null?a=r:l.next=o,!Hn(r,t.memoizedState)&&(en=!0,f&&(n=va,n!==null)))throw n;t.memoizedState=r,t.baseState=a,t.baseQueue=l,i.lastRenderedState=r}return s===null&&(i.lanes=0),[t.memoizedState,i.dispatch]}function Vh(t){var e=Ft(),n=e.queue;if(n===null)throw Error(Q(311));n.lastRenderedReducer=t;var i=n.dispatch,s=n.pending,r=e.memoizedState;if(s!==null){n.pending=null;var a=s=s.next;do r=t(r,a.action),a=a.next;while(a!==s);Hn(r,e.memoizedState)||(en=!0),e.memoizedState=r,e.baseQueue===null&&(e.baseState=r),n.lastRenderedState=r}return[r,i]}function mx(t,e,n){var i=Ge,s=Ft(),r=nt;if(r){if(n===void 0)throw Error(Q(407));n=n()}else n=e();var a=!Hn((ft||s).memoizedState,n);a&&(s.memoizedState=n,en=!0),s=s.queue;var o=xx.bind(null,i,s,t);if(ml(2048,8,o,[t]),s.getSnapshot!==e||a||Ot!==null&&Ot.memoizedState.tag&1){if(i.flags|=2048,wa(9,vu(),vx.bind(null,i,s,n,e),null),gt===null)throw Error(Q(349));r||(Is&124)!==0||gx(i,e,n)}return n}function gx(t,e,n){t.flags|=16384,t={getSnapshot:e,value:n},e=Ge.updateQueue,e===null?(e=wp(),Ge.updateQueue=e,e.stores=[t]):(n=e.stores,n===null?e.stores=[t]:n.push(t))}function vx(t,e,n,i){e.value=n,e.getSnapshot=i,yx(e)&&_x(t)}function xx(t,e,n){return n(function(){yx(e)&&_x(t)})}function yx(t){var e=t.getSnapshot;t=t.value;try{var n=e();return!Hn(t,n)}catch{return!0}}function _x(t){var e=La(t,2);e!==null&&zn(e,t,2)}function Ud(t){var e=En();if(typeof t=="function"){var n=t;if(t=n(),_r){As(!0);try{n()}finally{As(!1)}}}return e.memoizedState=e.baseState=t,e.queue={pending:null,lanes:0,dispatch:null,lastRenderedReducer:ji,lastRenderedState:t},e}function Ax(t,e,n,i){return t.baseState=n,Rp(t,ft,typeof i=="function"?i:ji)}function K1(t,e,n,i,s){if(xu(t))throw Error(Q(485));if(t=e.action,t!==null){var r={payload:s,action:t,next:null,isTransition:!0,status:"pending",value:null,reason:null,listeners:[],then:function(a){r.listeners.push(a)}};De.T!==null?n(!0):r.isTransition=!1,i(r),n=e.pending,n===null?(r.next=e.pending=r,Sx(e,r)):(r.next=n.next,e.pending=n.next=r)}}function Sx(t,e){var n=e.action,i=e.payload,s=t.state;if(e.isTransition){var r=De.T,a={};De.T=a;try{var o=n(s,i),l=De.S;l!==null&&l(a,o),Dv(t,e,o)}catch(c){Bd(t,e,c)}finally{De.T=r}}else try{r=n(s,i),Dv(t,e,r)}catch(c){Bd(t,e,c)}}function Dv(t,e,n){n!==null&&typeof n=="object"&&typeof n.then=="function"?n.then(function(i){Uv(t,e,i)},function(i){return Bd(t,e,i)}):Uv(t,e,n)}function Uv(t,e,n){e.status="fulfilled",e.value=n,Mx(e),t.state=n,e=t.pending,e!==null&&(n=e.next,n===e?t.pending=null:(n=n.next,e.next=n,Sx(t,n)))}function Bd(t,e,n){var i=t.pending;if(t.pending=null,i!==null){i=i.next;do e.status="rejected",e.reason=n,Mx(e),e=e.next;while(e!==i)}t.action=null}function Mx(t){t=t.listeners;for(var e=0;e<t.length;e++)(0,t[e])()}function Ex(t,e){return e}function Bv(t,e){if(nt){var n=gt.formState;if(n!==null){e:{var i=Ge;if(nt){if(Dt){t:{for(var s=Dt,r=Ei;s.nodeType!==8;){if(!r){s=null;break t}if(s=fi(s.nextSibling),s===null){s=null;break t}}r=s.data,s=r==="F!"||r==="F"?s:null}if(s){Dt=fi(s.nextSibling),i=s.data==="F!";break e}}xr(i)}i=!1}i&&(e=n[0])}}return n=En(),n.memoizedState=n.baseState=e,i={pending:null,lanes:0,dispatch:null,lastRenderedReducer:Ex,lastRenderedState:e},n.queue=i,n=Hx.bind(null,Ge,i),i.dispatch=n,i=Ud(!1),r=Ip.bind(null,Ge,!1,i.queue),i=En(),s={state:e,dispatch:null,action:t,pending:null},i.queue=s,n=K1.bind(null,Ge,s,r,n),s.dispatch=n,i.memoizedState=t,[e,n,!1]}function Iv(t){var e=Ft();return Tx(e,ft,t)}function Tx(t,e,n){if(e=Rp(t,e,Ex)[0],t=bc(ji)[0],typeof e=="object"&&e!==null&&typeof e.then=="function")try{var i=pl(e)}catch(a){throw a===dl?mu:a}else i=e;e=Ft();var s=e.queue,r=s.dispatch;return n!==e.memoizedState&&(Ge.flags|=2048,wa(9,vu(),J1.bind(null,s,n),null)),[i,r,t]}function J1(t,e){t.action=e}function Pv(t){var e=Ft(),n=ft;if(n!==null)return Tx(e,n,t);Ft(),e=e.memoizedState,n=Ft();var i=n.queue.dispatch;return n.memoizedState=t,[e,i,!1]}function wa(t,e,n,i){return t={tag:t,create:n,deps:i,inst:e,next:null},e=Ge.updateQueue,e===null&&(e=wp(),Ge.updateQueue=e),n=e.lastEffect,n===null?e.lastEffect=t.next=t:(i=n.next,n.next=t,t.next=i,e.lastEffect=t),t}function vu(){return{destroy:void 0,resource:void 0}}function bx(){return Ft().memoizedState}function wc(t,e,n,i){var s=En();i=i===void 0?null:i,Ge.flags|=t,s.memoizedState=wa(1|e,vu(),n,i)}function ml(t,e,n,i){var s=Ft();i=i===void 0?null:i;var r=s.memoizedState.inst;ft!==null&&i!==null&&Sp(i,ft.memoizedState.deps)?s.memoizedState=wa(e,r,n,i):(Ge.flags|=t,s.memoizedState=wa(1|e,r,n,i))}function Lv(t,e){wc(8390656,8,t,e)}function wx(t,e){ml(2048,8,t,e)}function Cx(t,e){return ml(4,2,t,e)}function Rx(t,e){return ml(4,4,t,e)}function Dx(t,e){if(typeof e=="function"){t=t();var n=e(t);return function(){typeof n=="function"?n():e(null)}}if(e!=null)return t=t(),e.current=t,function(){e.current=null}}function Ux(t,e,n){n=n!=null?n.concat([t]):null,ml(4,4,Dx.bind(null,e,t),n)}function Dp(){}function Bx(t,e){var n=Ft();e=e===void 0?null:e;var i=n.memoizedState;return e!==null&&Sp(e,i[1])?i[0]:(n.memoizedState=[t,e],t)}function Ix(t,e){var n=Ft();e=e===void 0?null:e;var i=n.memoizedState;if(e!==null&&Sp(e,i[1]))return i[0];if(i=t(),_r){As(!0);try{t()}finally{As(!1)}}return n.memoizedState=[i,e],i}function Up(t,e,n){return n===void 0||(Is&1073741824)!==0?t.memoizedState=e:(t.memoizedState=n,t=My(),Ge.lanes|=t,Ls|=t,n)}function Px(t,e,n,i){return Hn(n,e)?n:ba.current!==null?(t=Up(t,n,i),Hn(t,e)||(en=!0),t):(Is&42)===0?(en=!0,t.memoizedState=n):(t=My(),Ge.lanes|=t,Ls|=t,e)}function Lx(t,e,n,i,s){var r=it.p;it.p=r!==0&&8>r?r:8;var a=De.T,o={};De.T=o,Ip(t,!1,e,n);try{var l=s(),c=De.S;if(c!==null&&c(o,l),l!==null&&typeof l=="object"&&typeof l.then=="function"){var f=q1(l,i);Fo(t,e,f,Fn(t))}else Fo(t,e,i,Fn(t))}catch(p){Fo(t,e,{then:function(){},status:"rejected",reason:p},Fn())}finally{it.p=r,De.T=a}}function j1(){}function Id(t,e,n,i){if(t.tag!==5)throw Error(Q(476));var s=Nx(t).queue;Lx(t,s,e,fr,n===null?j1:function(){return Ox(t),n(i)})}function Nx(t){var e=t.memoizedState;if(e!==null)return e;e={memoizedState:fr,baseState:fr,baseQueue:null,queue:{pending:null,lanes:0,dispatch:null,lastRenderedReducer:ji,lastRenderedState:fr},next:null};var n={};return e.next={memoizedState:n,baseState:n,baseQueue:null,queue:{pending:null,lanes:0,dispatch:null,lastRenderedReducer:ji,lastRenderedState:n},next:null},t.memoizedState=e,t=t.alternate,t!==null&&(t.memoizedState=e),e}function Ox(t){var e=Nx(t).next.queue;Fo(t,e,{},Fn())}function Bp(){return un(el)}function Fx(){return Ft().memoizedState}function zx(){return Ft().memoizedState}function $1(t){for(var e=t.return;e!==null;){switch(e.tag){case 24:case 3:var n=Fn();t=bs(n);var i=ws(e,t,n);i!==null&&(zn(i,e,n),Lo(i,e,n)),e={cache:xp()},t.payload=e;return}e=e.return}}function eM(t,e,n){var i=Fn();n={lane:i,revertLane:0,action:n,hasEagerState:!1,eagerState:null,next:null},xu(t)?Gx(e,n):(n=pp(t,e,n,i),n!==null&&(zn(n,t,i),kx(n,e,i)))}function Hx(t,e,n){var i=Fn();Fo(t,e,n,i)}function Fo(t,e,n,i){var s={lane:i,revertLane:0,action:n,hasEagerState:!1,eagerState:null,next:null};if(xu(t))Gx(e,s);else{var r=t.alternate;if(t.lanes===0&&(r===null||r.lanes===0)&&(r=e.lastRenderedReducer,r!==null))try{var a=e.lastRenderedState,o=r(a,n);if(s.hasEagerState=!0,s.eagerState=o,Hn(o,a))return pu(t,e,s,0),gt===null&&du(),!1}catch{}finally{}if(n=pp(t,e,s,i),n!==null)return zn(n,t,i),kx(n,e,i),!0}return!1}function Ip(t,e,n,i){if(i={lane:2,revertLane:Gp(),action:i,hasEagerState:!1,eagerState:null,next:null},xu(t)){if(e)throw Error(Q(479))}else e=pp(t,n,i,2),e!==null&&zn(e,t,2)}function xu(t){var e=t.alternate;return t===Ge||e!==null&&e===Ge}function Gx(t,e){xa=Wc=!0;var n=t.pending;n===null?e.next=e:(e.next=n.next,n.next=e),t.pending=e}function kx(t,e,n){if((n&4194048)!==0){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,B0(t,n)}}var Yc={readContext:un,use:gu,useCallback:Pt,useContext:Pt,useEffect:Pt,useImperativeHandle:Pt,useLayoutEffect:Pt,useInsertionEffect:Pt,useMemo:Pt,useReducer:Pt,useRef:Pt,useState:Pt,useDebugValue:Pt,useDeferredValue:Pt,useTransition:Pt,useSyncExternalStore:Pt,useId:Pt,useHostTransitionStatus:Pt,useFormState:Pt,useActionState:Pt,useOptimistic:Pt,useMemoCache:Pt,useCacheRefresh:Pt},Vx={readContext:un,use:gu,useCallback:function(t,e){return En().memoizedState=[t,e===void 0?null:e],t},useContext:un,useEffect:Lv,useImperativeHandle:function(t,e,n){n=n!=null?n.concat([t]):null,wc(4194308,4,Dx.bind(null,e,t),n)},useLayoutEffect:function(t,e){return wc(4194308,4,t,e)},useInsertionEffect:function(t,e){wc(4,2,t,e)},useMemo:function(t,e){var n=En();e=e===void 0?null:e;var i=t();if(_r){As(!0);try{t()}finally{As(!1)}}return n.memoizedState=[i,e],i},useReducer:function(t,e,n){var i=En();if(n!==void 0){var s=n(e);if(_r){As(!0);try{n(e)}finally{As(!1)}}}else s=e;return i.memoizedState=i.baseState=s,t={pending:null,lanes:0,dispatch:null,lastRenderedReducer:t,lastRenderedState:s},i.queue=t,t=t.dispatch=eM.bind(null,Ge,t),[i.memoizedState,t]},useRef:function(t){var e=En();return t={current:t},e.memoizedState=t},useState:function(t){t=Ud(t);var e=t.queue,n=Hx.bind(null,Ge,e);return e.dispatch=n,[t.memoizedState,n]},useDebugValue:Dp,useDeferredValue:function(t,e){var n=En();return Up(n,t,e)},useTransition:function(){var t=Ud(!1);return t=Lx.bind(null,Ge,t.queue,!0,!1),En().memoizedState=t,[!1,t]},useSyncExternalStore:function(t,e,n){var i=Ge,s=En();if(nt){if(n===void 0)throw Error(Q(407));n=n()}else{if(n=e(),gt===null)throw Error(Q(349));(Ke&124)!==0||gx(i,e,n)}s.memoizedState=n;var r={value:n,getSnapshot:e};return s.queue=r,Lv(xx.bind(null,i,r,t),[t]),i.flags|=2048,wa(9,vu(),vx.bind(null,i,r,n,e),null),n},useId:function(){var t=En(),e=gt.identifierPrefix;if(nt){var n=Yi,i=Xi;n=(i&~(1<<32-On(i)-1)).toString(32)+n,e="\xAB"+e+"R"+n,n=Xc++,0<n&&(e+="H"+n.toString(32)),e+="\xBB"}else n=Q1++,e="\xAB"+e+"r"+n.toString(32)+"\xBB";return t.memoizedState=e},useHostTransitionStatus:Bp,useFormState:Bv,useActionState:Bv,useOptimistic:function(t){var e=En();e.memoizedState=e.baseState=t;var n={pending:null,lanes:0,dispatch:null,lastRenderedReducer:null,lastRenderedState:null};return e.queue=n,e=Ip.bind(null,Ge,!0,n),n.dispatch=e,[t,e]},useMemoCache:Cp,useCacheRefresh:function(){return En().memoizedState=$1.bind(null,Ge)}},Wx={readContext:un,use:gu,useCallback:Bx,useContext:un,useEffect:wx,useImperativeHandle:Ux,useInsertionEffect:Cx,useLayoutEffect:Rx,useMemo:Ix,useReducer:bc,useRef:bx,useState:function(){return bc(ji)},useDebugValue:Dp,useDeferredValue:function(t,e){var n=Ft();return Px(n,ft.memoizedState,t,e)},useTransition:function(){var t=bc(ji)[0],e=Ft().memoizedState;return[typeof t=="boolean"?t:pl(t),e]},useSyncExternalStore:mx,useId:Fx,useHostTransitionStatus:Bp,useFormState:Iv,useActionState:Iv,useOptimistic:function(t,e){var n=Ft();return Ax(n,ft,t,e)},useMemoCache:Cp,useCacheRefresh:zx},tM={readContext:un,use:gu,useCallback:Bx,useContext:un,useEffect:wx,useImperativeHandle:Ux,useInsertionEffect:Cx,useLayoutEffect:Rx,useMemo:Ix,useReducer:Vh,useRef:bx,useState:function(){return Vh(ji)},useDebugValue:Dp,useDeferredValue:function(t,e){var n=Ft();return ft===null?Up(n,t,e):Px(n,ft.memoizedState,t,e)},useTransition:function(){var t=Vh(ji)[0],e=Ft().memoizedState;return[typeof t=="boolean"?t:pl(t),e]},useSyncExternalStore:mx,useId:Fx,useHostTransitionStatus:Bp,useFormState:Pv,useActionState:Pv,useOptimistic:function(t,e){var n=Ft();return ft!==null?Ax(n,ft,t,e):(n.baseState=t,[t,n.queue.dispatch])},useMemoCache:Cp,useCacheRefresh:zx},_a=null,Ko=0;function hc(t){var e=Ko;return Ko+=1,_a===null&&(_a=[]),ux(_a,t,e)}function Ao(t,e){e=e.props.ref,t.ref=e!==void 0?e:null}function dc(t,e){throw e.$$typeof===US?Error(Q(525)):(t=Object.prototype.toString.call(e),Error(Q(31,t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t)))}function Nv(t){var e=t._init;return e(t._payload)}function Xx(t){function e(u,g){if(t){var v=u.deletions;v===null?(u.deletions=[g],u.flags|=16):v.push(g)}}function n(u,g){if(!t)return null;for(;g!==null;)e(u,g),g=g.sibling;return null}function i(u){for(var g=new Map;u!==null;)u.key!==null?g.set(u.key,u):g.set(u.index,u),u=u.sibling;return g}function s(u,g){return u=Zi(u,g),u.index=0,u.sibling=null,u}function r(u,g,v){return u.index=v,t?(v=u.alternate,v!==null?(v=v.index,v<g?(u.flags|=67108866,g):v):(u.flags|=67108866,g)):(u.flags|=1048576,g)}function a(u){return t&&u.alternate===null&&(u.flags|=67108866),u}function o(u,g,v,x){return g===null||g.tag!==6?(g=Hh(v,u.mode,x),g.return=u,g):(g=s(g,v),g.return=u,g)}function l(u,g,v,x){var T=v.type;return T===na?f(u,g,v.props.children,x,v.key):g!==null&&(g.elementType===T||typeof T=="object"&&T!==null&&T.$$typeof===ms&&Nv(T)===g.type)?(g=s(g,v.props),Ao(g,v),g.return=u,g):(g=Ec(v.type,v.key,v.props,null,u.mode,x),Ao(g,v),g.return=u,g)}function c(u,g,v,x){return g===null||g.tag!==4||g.stateNode.containerInfo!==v.containerInfo||g.stateNode.implementation!==v.implementation?(g=Gh(v,u.mode,x),g.return=u,g):(g=s(g,v.children||[]),g.return=u,g)}function f(u,g,v,x,T){return g===null||g.tag!==7?(g=hr(v,u.mode,x,T),g.return=u,g):(g=s(g,v),g.return=u,g)}function p(u,g,v){if(typeof g=="string"&&g!==""||typeof g=="number"||typeof g=="bigint")return g=Hh(""+g,u.mode,v),g.return=u,g;if(typeof g=="object"&&g!==null){switch(g.$$typeof){case ic:return v=Ec(g.type,g.key,g.props,null,u.mode,v),Ao(v,g),v.return=u,v;case bo:return g=Gh(g,u.mode,v),g.return=u,g;case ms:var x=g._init;return g=x(g._payload),p(u,g,v)}if(wo(g)||xo(g))return g=hr(g,u.mode,v,null),g.return=u,g;if(typeof g.then=="function")return p(u,hc(g),v);if(g.$$typeof===Wi)return p(u,uc(u,g),v);dc(u,g)}return null}function h(u,g,v,x){var T=g!==null?g.key:null;if(typeof v=="string"&&v!==""||typeof v=="number"||typeof v=="bigint")return T!==null?null:o(u,g,""+v,x);if(typeof v=="object"&&v!==null){switch(v.$$typeof){case ic:return v.key===T?l(u,g,v,x):null;case bo:return v.key===T?c(u,g,v,x):null;case ms:return T=v._init,v=T(v._payload),h(u,g,v,x)}if(wo(v)||xo(v))return T!==null?null:f(u,g,v,x,null);if(typeof v.then=="function")return h(u,g,hc(v),x);if(v.$$typeof===Wi)return h(u,g,uc(u,v),x);dc(u,v)}return null}function d(u,g,v,x,T){if(typeof x=="string"&&x!==""||typeof x=="number"||typeof x=="bigint")return u=u.get(v)||null,o(g,u,""+x,T);if(typeof x=="object"&&x!==null){switch(x.$$typeof){case ic:return u=u.get(x.key===null?v:x.key)||null,l(g,u,x,T);case bo:return u=u.get(x.key===null?v:x.key)||null,c(g,u,x,T);case ms:var C=x._init;return x=C(x._payload),d(u,g,v,x,T)}if(wo(x)||xo(x))return u=u.get(v)||null,f(g,u,x,T,null);if(typeof x.then=="function")return d(u,g,v,hc(x),T);if(x.$$typeof===Wi)return d(u,g,v,uc(g,x),T);dc(g,x)}return null}function y(u,g,v,x){for(var T=null,C=null,w=g,D=g=0,E=null;w!==null&&D<v.length;D++){w.index>D?(E=w,w=null):E=w.sibling;var M=h(u,w,v[D],x);if(M===null){w===null&&(w=E);break}t&&w&&M.alternate===null&&e(u,w),g=r(M,g,D),C===null?T=M:C.sibling=M,C=M,w=E}if(D===v.length)return n(u,w),nt&&cr(u,D),T;if(w===null){for(;D<v.length;D++)w=p(u,v[D],x),w!==null&&(g=r(w,g,D),C===null?T=w:C.sibling=w,C=w);return nt&&cr(u,D),T}for(w=i(w);D<v.length;D++)E=d(w,u,D,v[D],x),E!==null&&(t&&E.alternate!==null&&w.delete(E.key===null?D:E.key),g=r(E,g,D),C===null?T=E:C.sibling=E,C=E);return t&&w.forEach(function(U){return e(u,U)}),nt&&cr(u,D),T}function _(u,g,v,x){if(v==null)throw Error(Q(151));for(var T=null,C=null,w=g,D=g=0,E=null,M=v.next();w!==null&&!M.done;D++,M=v.next()){w.index>D?(E=w,w=null):E=w.sibling;var U=h(u,w,M.value,x);if(U===null){w===null&&(w=E);break}t&&w&&U.alternate===null&&e(u,w),g=r(U,g,D),C===null?T=U:C.sibling=U,C=U,w=E}if(M.done)return n(u,w),nt&&cr(u,D),T;if(w===null){for(;!M.done;D++,M=v.next())M=p(u,M.value,x),M!==null&&(g=r(M,g,D),C===null?T=M:C.sibling=M,C=M);return nt&&cr(u,D),T}for(w=i(w);!M.done;D++,M=v.next())M=d(w,u,D,M.value,x),M!==null&&(t&&M.alternate!==null&&w.delete(M.key===null?D:M.key),g=r(M,g,D),C===null?T=M:C.sibling=M,C=M);return t&&w.forEach(function(G){return e(u,G)}),nt&&cr(u,D),T}function m(u,g,v,x){if(typeof v=="object"&&v!==null&&v.type===na&&v.key===null&&(v=v.props.children),typeof v=="object"&&v!==null){switch(v.$$typeof){case ic:e:{for(var T=v.key;g!==null;){if(g.key===T){if(T=v.type,T===na){if(g.tag===7){n(u,g.sibling),x=s(g,v.props.children),x.return=u,u=x;break e}}else if(g.elementType===T||typeof T=="object"&&T!==null&&T.$$typeof===ms&&Nv(T)===g.type){n(u,g.sibling),x=s(g,v.props),Ao(x,v),x.return=u,u=x;break e}n(u,g);break}else e(u,g);g=g.sibling}v.type===na?(x=hr(v.props.children,u.mode,x,v.key),x.return=u,u=x):(x=Ec(v.type,v.key,v.props,null,u.mode,x),Ao(x,v),x.return=u,u=x)}return a(u);case bo:e:{for(T=v.key;g!==null;){if(g.key===T)if(g.tag===4&&g.stateNode.containerInfo===v.containerInfo&&g.stateNode.implementation===v.implementation){n(u,g.sibling),x=s(g,v.children||[]),x.return=u,u=x;break e}else{n(u,g);break}else e(u,g);g=g.sibling}x=Gh(v,u.mode,x),x.return=u,u=x}return a(u);case ms:return T=v._init,v=T(v._payload),m(u,g,v,x)}if(wo(v))return y(u,g,v,x);if(xo(v)){if(T=xo(v),typeof T!="function")throw Error(Q(150));return v=T.call(v),_(u,g,v,x)}if(typeof v.then=="function")return m(u,g,hc(v),x);if(v.$$typeof===Wi)return m(u,g,uc(u,v),x);dc(u,v)}return typeof v=="string"&&v!==""||typeof v=="number"||typeof v=="bigint"?(v=""+v,g!==null&&g.tag===6?(n(u,g.sibling),x=s(g,v),x.return=u,u=x):(n(u,g),x=Hh(v,u.mode,x),x.return=u,u=x),a(u)):n(u,g)}return function(u,g,v,x){try{Ko=0;var T=m(u,g,v,x);return _a=null,T}catch(w){if(w===dl||w===mu)throw w;var C=Ln(29,w,null,u.mode);return C.lanes=x,C.return=u,C}finally{}}}var Ca=Xx(!0),Yx=Xx(!1),ii=Ri(null),Ci=null;function xs(t){var e=t.alternate;Tt(Vt,Vt.current&1),Tt(ii,t),Ci===null&&(e===null||ba.current!==null||e.memoizedState!==null)&&(Ci=t)}function qx(t){if(t.tag===22){if(Tt(Vt,Vt.current),Tt(ii,t),Ci===null){var e=t.alternate;e!==null&&e.memoizedState!==null&&(Ci=t)}}else ys(t)}function ys(){Tt(Vt,Vt.current),Tt(ii,ii.current)}function Qi(t){tn(ii),Ci===t&&(Ci=null),tn(Vt)}var Vt=Ri(0);function qc(t){for(var e=t;e!==null;){if(e.tag===13){var n=e.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||n.data==="$?"||Kd(n)))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if((e.flags&128)!==0)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}function Wh(t,e,n,i){e=t.memoizedState,n=n(i,e),n=n==null?e:yt({},e,n),t.memoizedState=n,t.lanes===0&&(t.updateQueue.baseState=n)}var Pd={enqueueSetState:function(t,e,n){t=t._reactInternals;var i=Fn(),s=bs(i);s.payload=e,n!=null&&(s.callback=n),e=ws(t,s,i),e!==null&&(zn(e,t,i),Lo(e,t,i))},enqueueReplaceState:function(t,e,n){t=t._reactInternals;var i=Fn(),s=bs(i);s.tag=1,s.payload=e,n!=null&&(s.callback=n),e=ws(t,s,i),e!==null&&(zn(e,t,i),Lo(e,t,i))},enqueueForceUpdate:function(t,e){t=t._reactInternals;var n=Fn(),i=bs(n);i.tag=2,e!=null&&(i.callback=e),e=ws(t,i,n),e!==null&&(zn(e,t,n),Lo(e,t,n))}};function Ov(t,e,n,i,s,r,a){return t=t.stateNode,typeof t.shouldComponentUpdate=="function"?t.shouldComponentUpdate(i,r,a):e.prototype&&e.prototype.isPureReactComponent?!qo(n,i)||!qo(s,r):!0}function Fv(t,e,n,i){t=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(n,i),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(n,i),e.state!==t&&Pd.enqueueReplaceState(e,e.state,null)}function Ar(t,e){var n=e;if("ref"in e){n={};for(var i in e)i!=="ref"&&(n[i]=e[i])}if(t=t.defaultProps){n===e&&(n=yt({},n));for(var s in t)n[s]===void 0&&(n[s]=t[s])}return n}var Qc=typeof reportError=="function"?reportError:function(t){if(typeof window=="object"&&typeof window.ErrorEvent=="function"){var e=new window.ErrorEvent("error",{bubbles:!0,cancelable:!0,message:typeof t=="object"&&t!==null&&typeof t.message=="string"?String(t.message):String(t),error:t});if(!window.dispatchEvent(e))return}else if(typeof process=="object"&&typeof process.emit=="function"){process.emit("uncaughtException",t);return}console.error(t)};function Qx(t){Qc(t)}function Zx(t){console.error(t)}function Kx(t){Qc(t)}function Zc(t,e){try{var n=t.onUncaughtError;n(e.value,{componentStack:e.stack})}catch(i){setTimeout(function(){throw i})}}function zv(t,e,n){try{var i=t.onCaughtError;i(n.value,{componentStack:n.stack,errorBoundary:e.tag===1?e.stateNode:null})}catch(s){setTimeout(function(){throw s})}}function Ld(t,e,n){return n=bs(n),n.tag=3,n.payload={element:null},n.callback=function(){Zc(t,e)},n}function Jx(t){return t=bs(t),t.tag=3,t}function jx(t,e,n,i){var s=n.type.getDerivedStateFromError;if(typeof s=="function"){var r=i.value;t.payload=function(){return s(r)},t.callback=function(){zv(e,n,i)}}var a=n.stateNode;a!==null&&typeof a.componentDidCatch=="function"&&(t.callback=function(){zv(e,n,i),typeof s!="function"&&(Cs===null?Cs=new Set([this]):Cs.add(this));var o=i.stack;this.componentDidCatch(i.value,{componentStack:o!==null?o:""})})}function nM(t,e,n,i,s){if(n.flags|=32768,i!==null&&typeof i=="object"&&typeof i.then=="function"){if(e=n.alternate,e!==null&&fl(e,n,s,!0),n=ii.current,n!==null){switch(n.tag){case 13:return Ci===null?Vd():n.alternate===null&&Ut===0&&(Ut=3),n.flags&=-257,n.flags|=65536,n.lanes=s,i===wd?n.flags|=16384:(e=n.updateQueue,e===null?n.updateQueue=new Set([i]):e.add(i),td(t,i,s)),!1;case 22:return n.flags|=65536,i===wd?n.flags|=16384:(e=n.updateQueue,e===null?(e={transitions:null,markerInstances:null,retryQueue:new Set([i])},n.updateQueue=e):(n=e.retryQueue,n===null?e.retryQueue=new Set([i]):n.add(i)),td(t,i,s)),!1}throw Error(Q(435,n.tag))}return td(t,i,s),Vd(),!1}if(nt)return e=ii.current,e!==null?((e.flags&65536)===0&&(e.flags|=256),e.flags|=65536,e.lanes=s,i!==Sd&&(t=Error(Q(422),{cause:i}),Qo(ti(t,n)))):(i!==Sd&&(e=Error(Q(423),{cause:i}),Qo(ti(e,n))),t=t.current.alternate,t.flags|=65536,s&=-s,t.lanes|=s,i=ti(i,n),s=Ld(t.stateNode,i,s),kh(t,s),Ut!==4&&(Ut=2)),!1;var r=Error(Q(520),{cause:i});if(r=ti(r,n),Go===null?Go=[r]:Go.push(r),Ut!==4&&(Ut=2),e===null)return!0;i=ti(i,n),n=e;do{switch(n.tag){case 3:return n.flags|=65536,t=s&-s,n.lanes|=t,t=Ld(n.stateNode,i,t),kh(n,t),!1;case 1:if(e=n.type,r=n.stateNode,(n.flags&128)===0&&(typeof e.getDerivedStateFromError=="function"||r!==null&&typeof r.componentDidCatch=="function"&&(Cs===null||!Cs.has(r))))return n.flags|=65536,s&=-s,n.lanes|=s,s=Jx(s),jx(s,t,n,i),kh(n,s),!1}n=n.return}while(n!==null);return!1}var $x=Error(Q(461)),en=!1;function rn(t,e,n,i){e.child=t===null?Yx(e,null,n,i):Ca(e,t.child,n,i)}function Hv(t,e,n,i,s){n=n.render;var r=e.ref;if("ref"in i){var a={};for(var o in i)o!=="ref"&&(a[o]=i[o])}else a=i;return yr(e),i=Mp(t,e,n,a,r,s),o=Ep(),t!==null&&!en?(Tp(t,e,s),$i(t,e,s)):(nt&&o&&gp(e),e.flags|=1,rn(t,e,i,s),e.child)}function Gv(t,e,n,i,s){if(t===null){var r=n.type;return typeof r=="function"&&!mp(r)&&r.defaultProps===void 0&&n.compare===null?(e.tag=15,e.type=r,ey(t,e,r,i,s)):(t=Ec(n.type,null,i,e,e.mode,s),t.ref=e.ref,t.return=e,e.child=t)}if(r=t.child,!Pp(t,s)){var a=r.memoizedProps;if(n=n.compare,n=n!==null?n:qo,n(a,i)&&t.ref===e.ref)return $i(t,e,s)}return e.flags|=1,t=Zi(r,i),t.ref=e.ref,t.return=e,e.child=t}function ey(t,e,n,i,s){if(t!==null){var r=t.memoizedProps;if(qo(r,i)&&t.ref===e.ref)if(en=!1,e.pendingProps=i=r,Pp(t,s))(t.flags&131072)!==0&&(en=!0);else return e.lanes=t.lanes,$i(t,e,s)}return Nd(t,e,n,i,s)}function ty(t,e,n){var i=e.pendingProps,s=i.children,r=t!==null?t.memoizedState:null;if(i.mode==="hidden"){if((e.flags&128)!==0){if(i=r!==null?r.baseLanes|n:n,t!==null){for(s=e.child=t.child,r=0;s!==null;)r=r|s.lanes|s.childLanes,s=s.sibling;e.childLanes=r&~i}else e.childLanes=0,e.child=null;return kv(t,e,i,n)}if((n&536870912)!==0)e.memoizedState={baseLanes:0,cachePool:null},t!==null&&Tc(e,r!==null?r.cachePool:null),r!==null?Rv(e,r):Dd(),qx(e);else return e.lanes=e.childLanes=536870912,kv(t,e,r!==null?r.baseLanes|n:n,n)}else r!==null?(Tc(e,r.cachePool),Rv(e,r),ys(e),e.memoizedState=null):(t!==null&&Tc(e,null),Dd(),ys(e));return rn(t,e,s,n),e.child}function kv(t,e,n,i){var s=yp();return s=s===null?null:{parent:kt._currentValue,pool:s},e.memoizedState={baseLanes:n,cachePool:s},t!==null&&Tc(e,null),Dd(),qx(e),t!==null&&fl(t,e,i,!0),null}function Cc(t,e){var n=e.ref;if(n===null)t!==null&&t.ref!==null&&(e.flags|=4194816);else{if(typeof n!="function"&&typeof n!="object")throw Error(Q(284));(t===null||t.ref!==n)&&(e.flags|=4194816)}}function Nd(t,e,n,i,s){return yr(e),n=Mp(t,e,n,i,void 0,s),i=Ep(),t!==null&&!en?(Tp(t,e,s),$i(t,e,s)):(nt&&i&&gp(e),e.flags|=1,rn(t,e,n,s),e.child)}function Vv(t,e,n,i,s,r){return yr(e),e.updateQueue=null,n=px(e,i,n,s),dx(t),i=Ep(),t!==null&&!en?(Tp(t,e,r),$i(t,e,r)):(nt&&i&&gp(e),e.flags|=1,rn(t,e,n,r),e.child)}function Wv(t,e,n,i,s){if(yr(e),e.stateNode===null){var r=ua,a=n.contextType;typeof a=="object"&&a!==null&&(r=un(a)),r=new n(i,r),e.memoizedState=r.state!==null&&r.state!==void 0?r.state:null,r.updater=Pd,e.stateNode=r,r._reactInternals=e,r=e.stateNode,r.props=i,r.state=e.memoizedState,r.refs={},_p(e),a=n.contextType,r.context=typeof a=="object"&&a!==null?un(a):ua,r.state=e.memoizedState,a=n.getDerivedStateFromProps,typeof a=="function"&&(Wh(e,n,a,i),r.state=e.memoizedState),typeof n.getDerivedStateFromProps=="function"||typeof r.getSnapshotBeforeUpdate=="function"||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(a=r.state,typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount(),a!==r.state&&Pd.enqueueReplaceState(r,r.state,null),Oo(e,i,r,s),No(),r.state=e.memoizedState),typeof r.componentDidMount=="function"&&(e.flags|=4194308),i=!0}else if(t===null){r=e.stateNode;var o=e.memoizedProps,l=Ar(n,o);r.props=l;var c=r.context,f=n.contextType;a=ua,typeof f=="object"&&f!==null&&(a=un(f));var p=n.getDerivedStateFromProps;f=typeof p=="function"||typeof r.getSnapshotBeforeUpdate=="function",o=e.pendingProps!==o,f||typeof r.UNSAFE_componentWillReceiveProps!="function"&&typeof r.componentWillReceiveProps!="function"||(o||c!==a)&&Fv(e,r,i,a),gs=!1;var h=e.memoizedState;r.state=h,Oo(e,i,r,s),No(),c=e.memoizedState,o||h!==c||gs?(typeof p=="function"&&(Wh(e,n,p,i),c=e.memoizedState),(l=gs||Ov(e,n,l,i,h,c,a))?(f||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount()),typeof r.componentDidMount=="function"&&(e.flags|=4194308)):(typeof r.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=i,e.memoizedState=c),r.props=i,r.state=c,r.context=a,i=l):(typeof r.componentDidMount=="function"&&(e.flags|=4194308),i=!1)}else{r=e.stateNode,Cd(t,e),a=e.memoizedProps,f=Ar(n,a),r.props=f,p=e.pendingProps,h=r.context,c=n.contextType,l=ua,typeof c=="object"&&c!==null&&(l=un(c)),o=n.getDerivedStateFromProps,(c=typeof o=="function"||typeof r.getSnapshotBeforeUpdate=="function")||typeof r.UNSAFE_componentWillReceiveProps!="function"&&typeof r.componentWillReceiveProps!="function"||(a!==p||h!==l)&&Fv(e,r,i,l),gs=!1,h=e.memoizedState,r.state=h,Oo(e,i,r,s),No();var d=e.memoizedState;a!==p||h!==d||gs||t!==null&&t.dependencies!==null&&kc(t.dependencies)?(typeof o=="function"&&(Wh(e,n,o,i),d=e.memoizedState),(f=gs||Ov(e,n,f,i,h,d,l)||t!==null&&t.dependencies!==null&&kc(t.dependencies))?(c||typeof r.UNSAFE_componentWillUpdate!="function"&&typeof r.componentWillUpdate!="function"||(typeof r.componentWillUpdate=="function"&&r.componentWillUpdate(i,d,l),typeof r.UNSAFE_componentWillUpdate=="function"&&r.UNSAFE_componentWillUpdate(i,d,l)),typeof r.componentDidUpdate=="function"&&(e.flags|=4),typeof r.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof r.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof r.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),e.memoizedProps=i,e.memoizedState=d),r.props=i,r.state=d,r.context=l,i=f):(typeof r.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof r.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),i=!1)}return r=i,Cc(t,e),i=(e.flags&128)!==0,r||i?(r=e.stateNode,n=i&&typeof n.getDerivedStateFromError!="function"?null:r.render(),e.flags|=1,t!==null&&i?(e.child=Ca(e,t.child,null,s),e.child=Ca(e,null,n,s)):rn(t,e,n,s),e.memoizedState=r.state,t=e.child):t=$i(t,e,s),t}function Xv(t,e,n,i){return ul(),e.flags|=256,rn(t,e,n,i),e.child}var Xh={dehydrated:null,treeContext:null,retryLane:0,hydrationErrors:null};function Yh(t){return{baseLanes:t,cachePool:lx()}}function qh(t,e,n){return t=t!==null?t.childLanes&~n:0,e&&(t|=ni),t}function ny(t,e,n){var i=e.pendingProps,s=!1,r=(e.flags&128)!==0,a;if((a=r)||(a=t!==null&&t.memoizedState===null?!1:(Vt.current&2)!==0),a&&(s=!0,e.flags&=-129),a=(e.flags&32)!==0,e.flags&=-33,t===null){if(nt){if(s?xs(e):ys(e),nt){var o=Dt,l;if(l=o){e:{for(l=o,o=Ei;l.nodeType!==8;){if(!o){o=null;break e}if(l=fi(l.nextSibling),l===null){o=null;break e}}o=l}o!==null?(e.memoizedState={dehydrated:o,treeContext:dr!==null?{id:Xi,overflow:Yi}:null,retryLane:536870912,hydrationErrors:null},l=Ln(18,null,null,0),l.stateNode=o,l.return=e,e.child=l,An=e,Dt=null,l=!0):l=!1}l||xr(e)}if(o=e.memoizedState,o!==null&&(o=o.dehydrated,o!==null))return Kd(o)?e.lanes=32:e.lanes=536870912,null;Qi(e)}return o=i.children,i=i.fallback,s?(ys(e),s=e.mode,o=Kc({mode:"hidden",children:o},s),i=hr(i,s,n,null),o.return=e,i.return=e,o.sibling=i,e.child=o,s=e.child,s.memoizedState=Yh(n),s.childLanes=qh(t,a,n),e.memoizedState=Xh,i):(xs(e),Od(e,o))}if(l=t.memoizedState,l!==null&&(o=l.dehydrated,o!==null)){if(r)e.flags&256?(xs(e),e.flags&=-257,e=Qh(t,e,n)):e.memoizedState!==null?(ys(e),e.child=t.child,e.flags|=128,e=null):(ys(e),s=i.fallback,o=e.mode,i=Kc({mode:"visible",children:i.children},o),s=hr(s,o,n,null),s.flags|=2,i.return=e,s.return=e,i.sibling=s,e.child=i,Ca(e,t.child,null,n),i=e.child,i.memoizedState=Yh(n),i.childLanes=qh(t,a,n),e.memoizedState=Xh,e=s);else if(xs(e),Kd(o)){if(a=o.nextSibling&&o.nextSibling.dataset,a)var c=a.dgst;a=c,i=Error(Q(419)),i.stack="",i.digest=a,Qo({value:i,source:null,stack:null}),e=Qh(t,e,n)}else if(en||fl(t,e,n,!1),a=(n&t.childLanes)!==0,en||a){if(a=gt,a!==null&&(i=n&-n,i=(i&42)!==0?1:sp(i),i=(i&(a.suspendedLanes|n))!==0?0:i,i!==0&&i!==l.retryLane))throw l.retryLane=i,La(t,i),zn(a,t,i),$x;o.data==="$?"||Vd(),e=Qh(t,e,n)}else o.data==="$?"?(e.flags|=192,e.child=t.child,e=null):(t=l.treeContext,Dt=fi(o.nextSibling),An=e,nt=!0,pr=null,Ei=!1,t!==null&&(jn[$n++]=Xi,jn[$n++]=Yi,jn[$n++]=dr,Xi=t.id,Yi=t.overflow,dr=e),e=Od(e,i.children),e.flags|=4096);return e}return s?(ys(e),s=i.fallback,o=e.mode,l=t.child,c=l.sibling,i=Zi(l,{mode:"hidden",children:i.children}),i.subtreeFlags=l.subtreeFlags&65011712,c!==null?s=Zi(c,s):(s=hr(s,o,n,null),s.flags|=2),s.return=e,i.return=e,i.sibling=s,e.child=i,i=s,s=e.child,o=t.child.memoizedState,o===null?o=Yh(n):(l=o.cachePool,l!==null?(c=kt._currentValue,l=l.parent!==c?{parent:c,pool:c}:l):l=lx(),o={baseLanes:o.baseLanes|n,cachePool:l}),s.memoizedState=o,s.childLanes=qh(t,a,n),e.memoizedState=Xh,i):(xs(e),n=t.child,t=n.sibling,n=Zi(n,{mode:"visible",children:i.children}),n.return=e,n.sibling=null,t!==null&&(a=e.deletions,a===null?(e.deletions=[t],e.flags|=16):a.push(t)),e.child=n,e.memoizedState=null,n)}function Od(t,e){return e=Kc({mode:"visible",children:e},t.mode),e.return=t,t.child=e}function Kc(t,e){return t=Ln(22,t,null,e),t.lanes=0,t.stateNode={_visibility:1,_pendingMarkers:null,_retryCache:null,_transitions:null},t}function Qh(t,e,n){return Ca(e,t.child,null,n),t=Od(e,e.pendingProps.children),t.flags|=2,e.memoizedState=null,t}function Yv(t,e,n){t.lanes|=e;var i=t.alternate;i!==null&&(i.lanes|=e),Ed(t.return,e,n)}function Zh(t,e,n,i,s){var r=t.memoizedState;r===null?t.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:i,tail:n,tailMode:s}:(r.isBackwards=e,r.rendering=null,r.renderingStartTime=0,r.last=i,r.tail=n,r.tailMode=s)}function iy(t,e,n){var i=e.pendingProps,s=i.revealOrder,r=i.tail;if(rn(t,e,i.children,n),i=Vt.current,(i&2)!==0)i=i&1|2,e.flags|=128;else{if(t!==null&&(t.flags&128)!==0)e:for(t=e.child;t!==null;){if(t.tag===13)t.memoizedState!==null&&Yv(t,n,e);else if(t.tag===19)Yv(t,n,e);else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break e;for(;t.sibling===null;){if(t.return===null||t.return===e)break e;t=t.return}t.sibling.return=t.return,t=t.sibling}i&=1}switch(Tt(Vt,i),s){case"forwards":for(n=e.child,s=null;n!==null;)t=n.alternate,t!==null&&qc(t)===null&&(s=n),n=n.sibling;n=s,n===null?(s=e.child,e.child=null):(s=n.sibling,n.sibling=null),Zh(e,!1,s,n,r);break;case"backwards":for(n=null,s=e.child,e.child=null;s!==null;){if(t=s.alternate,t!==null&&qc(t)===null){e.child=s;break}t=s.sibling,s.sibling=n,n=s,s=t}Zh(e,!0,n,null,r);break;case"together":Zh(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function $i(t,e,n){if(t!==null&&(e.dependencies=t.dependencies),Ls|=e.lanes,(n&e.childLanes)===0)if(t!==null){if(fl(t,e,n,!1),(n&e.childLanes)===0)return null}else return null;if(t!==null&&e.child!==t.child)throw Error(Q(153));if(e.child!==null){for(t=e.child,n=Zi(t,t.pendingProps),e.child=n,n.return=e;t.sibling!==null;)t=t.sibling,n=n.sibling=Zi(t,t.pendingProps),n.return=e;n.sibling=null}return e.child}function Pp(t,e){return(t.lanes&e)!==0?!0:(t=t.dependencies,!!(t!==null&&kc(t)))}function iM(t,e,n){switch(e.tag){case 3:Pc(e,e.stateNode.containerInfo),vs(e,kt,t.memoizedState.cache),ul();break;case 27:case 5:hd(e);break;case 4:Pc(e,e.stateNode.containerInfo);break;case 10:vs(e,e.type,e.memoizedProps.value);break;case 13:var i=e.memoizedState;if(i!==null)return i.dehydrated!==null?(xs(e),e.flags|=128,null):(n&e.child.childLanes)!==0?ny(t,e,n):(xs(e),t=$i(t,e,n),t!==null?t.sibling:null);xs(e);break;case 19:var s=(t.flags&128)!==0;if(i=(n&e.childLanes)!==0,i||(fl(t,e,n,!1),i=(n&e.childLanes)!==0),s){if(i)return iy(t,e,n);e.flags|=128}if(s=e.memoizedState,s!==null&&(s.rendering=null,s.tail=null,s.lastEffect=null),Tt(Vt,Vt.current),i)break;return null;case 22:case 23:return e.lanes=0,ty(t,e,n);case 24:vs(e,kt,t.memoizedState.cache)}return $i(t,e,n)}function sy(t,e,n){if(t!==null)if(t.memoizedProps!==e.pendingProps)en=!0;else{if(!Pp(t,n)&&(e.flags&128)===0)return en=!1,iM(t,e,n);en=(t.flags&131072)!==0}else en=!1,nt&&(e.flags&1048576)!==0&&ax(e,Gc,e.index);switch(e.lanes=0,e.tag){case 16:e:{t=e.pendingProps;var i=e.elementType,s=i._init;if(i=s(i._payload),e.type=i,typeof i=="function")mp(i)?(t=Ar(i,t),e.tag=1,e=Wv(null,e,i,t,n)):(e.tag=0,e=Nd(null,e,i,t,n));else{if(i!=null){if(s=i.$$typeof,s===tp){e.tag=11,e=Hv(null,e,i,t,n);break e}else if(s===np){e.tag=14,e=Gv(null,e,i,t,n);break e}}throw e=ud(i)||i,Error(Q(306,e,""))}}return e;case 0:return Nd(t,e,e.type,e.pendingProps,n);case 1:return i=e.type,s=Ar(i,e.pendingProps),Wv(t,e,i,s,n);case 3:e:{if(Pc(e,e.stateNode.containerInfo),t===null)throw Error(Q(387));i=e.pendingProps;var r=e.memoizedState;s=r.element,Cd(t,e),Oo(e,i,null,n);var a=e.memoizedState;if(i=a.cache,vs(e,kt,i),i!==r.cache&&Td(e,[kt],n,!0),No(),i=a.element,r.isDehydrated)if(r={element:i,isDehydrated:!1,cache:a.cache},e.updateQueue.baseState=r,e.memoizedState=r,e.flags&256){e=Xv(t,e,i,n);break e}else if(i!==s){s=ti(Error(Q(424)),e),Qo(s),e=Xv(t,e,i,n);break e}else{switch(t=e.stateNode.containerInfo,t.nodeType){case 9:t=t.body;break;default:t=t.nodeName==="HTML"?t.ownerDocument.body:t}for(Dt=fi(t.firstChild),An=e,nt=!0,pr=null,Ei=!0,n=Yx(e,null,i,n),e.child=n;n;)n.flags=n.flags&-3|4096,n=n.sibling}else{if(ul(),i===s){e=$i(t,e,n);break e}rn(t,e,i,n)}e=e.child}return e;case 26:return Cc(t,e),t===null?(n=f0(e.type,null,e.pendingProps,null))?e.memoizedState=n:nt||(n=e.type,t=e.pendingProps,i=iu(Ts.current).createElement(n),i[cn]=e,i[wn]=t,on(i,n,t),$t(i),e.stateNode=i):e.memoizedState=f0(e.type,t.memoizedProps,e.pendingProps,t.memoizedState),null;case 27:return hd(e),t===null&&nt&&(i=e.stateNode=Wy(e.type,e.pendingProps,Ts.current),An=e,Ei=!0,s=Dt,Os(e.type)?(Jd=s,Dt=fi(i.firstChild)):Dt=s),rn(t,e,e.pendingProps.children,n),Cc(t,e),t===null&&(e.flags|=4194304),e.child;case 5:return t===null&&nt&&((s=i=Dt)&&(i=RM(i,e.type,e.pendingProps,Ei),i!==null?(e.stateNode=i,An=e,Dt=fi(i.firstChild),Ei=!1,s=!0):s=!1),s||xr(e)),hd(e),s=e.type,r=e.pendingProps,a=t!==null?t.memoizedProps:null,i=r.children,Qd(s,r)?i=null:a!==null&&Qd(s,a)&&(e.flags|=32),e.memoizedState!==null&&(s=Mp(t,e,Z1,null,null,n),el._currentValue=s),Cc(t,e),rn(t,e,i,n),e.child;case 6:return t===null&&nt&&((t=n=Dt)&&(n=DM(n,e.pendingProps,Ei),n!==null?(e.stateNode=n,An=e,Dt=null,t=!0):t=!1),t||xr(e)),null;case 13:return ny(t,e,n);case 4:return Pc(e,e.stateNode.containerInfo),i=e.pendingProps,t===null?e.child=Ca(e,null,i,n):rn(t,e,i,n),e.child;case 11:return Hv(t,e,e.type,e.pendingProps,n);case 7:return rn(t,e,e.pendingProps,n),e.child;case 8:return rn(t,e,e.pendingProps.children,n),e.child;case 12:return rn(t,e,e.pendingProps.children,n),e.child;case 10:return i=e.pendingProps,vs(e,e.type,i.value),rn(t,e,i.children,n),e.child;case 9:return s=e.type._context,i=e.pendingProps.children,yr(e),s=un(s),i=i(s),e.flags|=1,rn(t,e,i,n),e.child;case 14:return Gv(t,e,e.type,e.pendingProps,n);case 15:return ey(t,e,e.type,e.pendingProps,n);case 19:return iy(t,e,n);case 31:return i=e.pendingProps,n=e.mode,i={mode:i.mode,children:i.children},t===null?(n=Kc(i,n),n.ref=e.ref,e.child=n,n.return=e,e=n):(n=Zi(t.child,i),n.ref=e.ref,e.child=n,n.return=e,e=n),e;case 22:return ty(t,e,n);case 24:return yr(e),i=un(kt),t===null?(s=yp(),s===null&&(s=gt,r=xp(),s.pooledCache=r,r.refCount++,r!==null&&(s.pooledCacheLanes|=n),s=r),e.memoizedState={parent:i,cache:s},_p(e),vs(e,kt,s)):((t.lanes&n)!==0&&(Cd(t,e),Oo(e,null,null,n),No()),s=t.memoizedState,r=e.memoizedState,s.parent!==i?(s={parent:i,cache:i},e.memoizedState=s,e.lanes===0&&(e.memoizedState=e.updateQueue.baseState=s),vs(e,kt,i)):(i=r.cache,vs(e,kt,i),i!==s.cache&&Td(e,[kt],n,!0))),rn(t,e,e.pendingProps.children,n),e.child;case 29:throw e.pendingProps}throw Error(Q(156,e.tag))}function Gi(t){t.flags|=4}function qv(t,e){if(e.type!=="stylesheet"||(e.state.loading&4)!==0)t.flags&=-16777217;else if(t.flags|=16777216,!qy(e)){if(e=ii.current,e!==null&&((Ke&4194048)===Ke?Ci!==null:(Ke&62914560)!==Ke&&(Ke&536870912)===0||e!==Ci))throw Po=wd,cx;t.flags|=8192}}function pc(t,e){e!==null&&(t.flags|=4),t.flags&16384&&(e=t.tag!==22?D0():536870912,t.lanes|=e,Ra|=e)}function So(t,e){if(!nt)switch(t.tailMode){case"hidden":e=t.tail;for(var n=null;e!==null;)e.alternate!==null&&(n=e),e=e.sibling;n===null?t.tail=null:n.sibling=null;break;case"collapsed":n=t.tail;for(var i=null;n!==null;)n.alternate!==null&&(i=n),n=n.sibling;i===null?e||t.tail===null?t.tail=null:t.tail.sibling=null:i.sibling=null}}function Ct(t){var e=t.alternate!==null&&t.alternate.child===t.child,n=0,i=0;if(e)for(var s=t.child;s!==null;)n|=s.lanes|s.childLanes,i|=s.subtreeFlags&65011712,i|=s.flags&65011712,s.return=t,s=s.sibling;else for(s=t.child;s!==null;)n|=s.lanes|s.childLanes,i|=s.subtreeFlags,i|=s.flags,s.return=t,s=s.sibling;return t.subtreeFlags|=i,t.childLanes=n,e}function sM(t,e,n){var i=e.pendingProps;switch(vp(e),e.tag){case 31:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return Ct(e),null;case 1:return Ct(e),null;case 3:return n=e.stateNode,i=null,t!==null&&(i=t.memoizedState.cache),e.memoizedState.cache!==i&&(e.flags|=2048),Ki(kt),Sa(),n.pendingContext&&(n.context=n.pendingContext,n.pendingContext=null),(t===null||t.child===null)&&(_o(e)?Gi(e):t===null||t.memoizedState.isDehydrated&&(e.flags&256)===0||(e.flags|=1024,Mv())),Ct(e),null;case 26:return n=e.memoizedState,t===null?(Gi(e),n!==null?(Ct(e),qv(e,n)):(Ct(e),e.flags&=-16777217)):n?n!==t.memoizedState?(Gi(e),Ct(e),qv(e,n)):(Ct(e),e.flags&=-16777217):(t.memoizedProps!==i&&Gi(e),Ct(e),e.flags&=-16777217),null;case 27:Lc(e),n=Ts.current;var s=e.type;if(t!==null&&e.stateNode!=null)t.memoizedProps!==i&&Gi(e);else{if(!i){if(e.stateNode===null)throw Error(Q(166));return Ct(e),null}t=bi.current,_o(e)?Av(e,t):(t=Wy(s,i,n),e.stateNode=t,Gi(e))}return Ct(e),null;case 5:if(Lc(e),n=e.type,t!==null&&e.stateNode!=null)t.memoizedProps!==i&&Gi(e);else{if(!i){if(e.stateNode===null)throw Error(Q(166));return Ct(e),null}if(t=bi.current,_o(e))Av(e,t);else{switch(s=iu(Ts.current),t){case 1:t=s.createElementNS("http://www.w3.org/2000/svg",n);break;case 2:t=s.createElementNS("http://www.w3.org/1998/Math/MathML",n);break;default:switch(n){case"svg":t=s.createElementNS("http://www.w3.org/2000/svg",n);break;case"math":t=s.createElementNS("http://www.w3.org/1998/Math/MathML",n);break;case"script":t=s.createElement("div"),t.innerHTML="<script><\/script>",t=t.removeChild(t.firstChild);break;case"select":t=typeof i.is=="string"?s.createElement("select",{is:i.is}):s.createElement("select"),i.multiple?t.multiple=!0:i.size&&(t.size=i.size);break;default:t=typeof i.is=="string"?s.createElement(n,{is:i.is}):s.createElement(n)}}t[cn]=e,t[wn]=i;e:for(s=e.child;s!==null;){if(s.tag===5||s.tag===6)t.appendChild(s.stateNode);else if(s.tag!==4&&s.tag!==27&&s.child!==null){s.child.return=s,s=s.child;continue}if(s===e)break e;for(;s.sibling===null;){if(s.return===null||s.return===e)break e;s=s.return}s.sibling.return=s.return,s=s.sibling}e.stateNode=t;e:switch(on(t,n,i),n){case"button":case"input":case"select":case"textarea":t=!!i.autoFocus;break e;case"img":t=!0;break e;default:t=!1}t&&Gi(e)}}return Ct(e),e.flags&=-16777217,null;case 6:if(t&&e.stateNode!=null)t.memoizedProps!==i&&Gi(e);else{if(typeof i!="string"&&e.stateNode===null)throw Error(Q(166));if(t=Ts.current,_o(e)){if(t=e.stateNode,n=e.memoizedProps,i=null,s=An,s!==null)switch(s.tag){case 27:case 5:i=s.memoizedProps}t[cn]=e,t=!!(t.nodeValue===n||i!==null&&i.suppressHydrationWarning===!0||Gy(t.nodeValue,n)),t||xr(e)}else t=iu(t).createTextNode(i),t[cn]=e,e.stateNode=t}return Ct(e),null;case 13:if(i=e.memoizedState,t===null||t.memoizedState!==null&&t.memoizedState.dehydrated!==null){if(s=_o(e),i!==null&&i.dehydrated!==null){if(t===null){if(!s)throw Error(Q(318));if(s=e.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(Q(317));s[cn]=e}else ul(),(e.flags&128)===0&&(e.memoizedState=null),e.flags|=4;Ct(e),s=!1}else s=Mv(),t!==null&&t.memoizedState!==null&&(t.memoizedState.hydrationErrors=s),s=!0;if(!s)return e.flags&256?(Qi(e),e):(Qi(e),null)}if(Qi(e),(e.flags&128)!==0)return e.lanes=n,e;if(n=i!==null,t=t!==null&&t.memoizedState!==null,n){i=e.child,s=null,i.alternate!==null&&i.alternate.memoizedState!==null&&i.alternate.memoizedState.cachePool!==null&&(s=i.alternate.memoizedState.cachePool.pool);var r=null;i.memoizedState!==null&&i.memoizedState.cachePool!==null&&(r=i.memoizedState.cachePool.pool),r!==s&&(i.flags|=2048)}return n!==t&&n&&(e.child.flags|=8192),pc(e,e.updateQueue),Ct(e),null;case 4:return Sa(),t===null&&kp(e.stateNode.containerInfo),Ct(e),null;case 10:return Ki(e.type),Ct(e),null;case 19:if(tn(Vt),s=e.memoizedState,s===null)return Ct(e),null;if(i=(e.flags&128)!==0,r=s.rendering,r===null)if(i)So(s,!1);else{if(Ut!==0||t!==null&&(t.flags&128)!==0)for(t=e.child;t!==null;){if(r=qc(t),r!==null){for(e.flags|=128,So(s,!1),t=r.updateQueue,e.updateQueue=t,pc(e,t),e.subtreeFlags=0,t=n,n=e.child;n!==null;)rx(n,t),n=n.sibling;return Tt(Vt,Vt.current&1|2),e.child}t=t.sibling}s.tail!==null&&wi()>jc&&(e.flags|=128,i=!0,So(s,!1),e.lanes=4194304)}else{if(!i)if(t=qc(r),t!==null){if(e.flags|=128,i=!0,t=t.updateQueue,e.updateQueue=t,pc(e,t),So(s,!0),s.tail===null&&s.tailMode==="hidden"&&!r.alternate&&!nt)return Ct(e),null}else 2*wi()-s.renderingStartTime>jc&&n!==536870912&&(e.flags|=128,i=!0,So(s,!1),e.lanes=4194304);s.isBackwards?(r.sibling=e.child,e.child=r):(t=s.last,t!==null?t.sibling=r:e.child=r,s.last=r)}return s.tail!==null?(e=s.tail,s.rendering=e,s.tail=e.sibling,s.renderingStartTime=wi(),e.sibling=null,t=Vt.current,Tt(Vt,i?t&1|2:t&1),e):(Ct(e),null);case 22:case 23:return Qi(e),Ap(),i=e.memoizedState!==null,t!==null?t.memoizedState!==null!==i&&(e.flags|=8192):i&&(e.flags|=8192),i?(n&536870912)!==0&&(e.flags&128)===0&&(Ct(e),e.subtreeFlags&6&&(e.flags|=8192)):Ct(e),n=e.updateQueue,n!==null&&pc(e,n.retryQueue),n=null,t!==null&&t.memoizedState!==null&&t.memoizedState.cachePool!==null&&(n=t.memoizedState.cachePool.pool),i=null,e.memoizedState!==null&&e.memoizedState.cachePool!==null&&(i=e.memoizedState.cachePool.pool),i!==n&&(e.flags|=2048),t!==null&&tn(mr),null;case 24:return n=null,t!==null&&(n=t.memoizedState.cache),e.memoizedState.cache!==n&&(e.flags|=2048),Ki(kt),Ct(e),null;case 25:return null;case 30:return null}throw Error(Q(156,e.tag))}function rM(t,e){switch(vp(e),e.tag){case 1:return t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 3:return Ki(kt),Sa(),t=e.flags,(t&65536)!==0&&(t&128)===0?(e.flags=t&-65537|128,e):null;case 26:case 27:case 5:return Lc(e),null;case 13:if(Qi(e),t=e.memoizedState,t!==null&&t.dehydrated!==null){if(e.alternate===null)throw Error(Q(340));ul()}return t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 19:return tn(Vt),null;case 4:return Sa(),null;case 10:return Ki(e.type),null;case 22:case 23:return Qi(e),Ap(),t!==null&&tn(mr),t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 24:return Ki(kt),null;case 25:return null;default:return null}}function ry(t,e){switch(vp(e),e.tag){case 3:Ki(kt),Sa();break;case 26:case 27:case 5:Lc(e);break;case 4:Sa();break;case 13:Qi(e);break;case 19:tn(Vt);break;case 10:Ki(e.type);break;case 22:case 23:Qi(e),Ap(),t!==null&&tn(mr);break;case 24:Ki(kt)}}function gl(t,e){try{var n=e.updateQueue,i=n!==null?n.lastEffect:null;if(i!==null){var s=i.next;n=s;do{if((n.tag&t)===t){i=void 0;var r=n.create,a=n.inst;i=r(),a.destroy=i}n=n.next}while(n!==s)}}catch(o){pt(e,e.return,o)}}function Ps(t,e,n){try{var i=e.updateQueue,s=i!==null?i.lastEffect:null;if(s!==null){var r=s.next;i=r;do{if((i.tag&t)===t){var a=i.inst,o=a.destroy;if(o!==void 0){a.destroy=void 0,s=e;var l=n,c=o;try{c()}catch(f){pt(s,l,f)}}}i=i.next}while(i!==r)}}catch(f){pt(e,e.return,f)}}function ay(t){var e=t.updateQueue;if(e!==null){var n=t.stateNode;try{hx(e,n)}catch(i){pt(t,t.return,i)}}}function oy(t,e,n){n.props=Ar(t.type,t.memoizedProps),n.state=t.memoizedState;try{n.componentWillUnmount()}catch(i){pt(t,e,i)}}function zo(t,e){try{var n=t.ref;if(n!==null){switch(t.tag){case 26:case 27:case 5:var i=t.stateNode;break;case 30:i=t.stateNode;break;default:i=t.stateNode}typeof n=="function"?t.refCleanup=n(i):n.current=i}}catch(s){pt(t,e,s)}}function Ti(t,e){var n=t.ref,i=t.refCleanup;if(n!==null)if(typeof i=="function")try{i()}catch(s){pt(t,e,s)}finally{t.refCleanup=null,t=t.alternate,t!=null&&(t.refCleanup=null)}else if(typeof n=="function")try{n(null)}catch(s){pt(t,e,s)}else n.current=null}function ly(t){var e=t.type,n=t.memoizedProps,i=t.stateNode;try{e:switch(e){case"button":case"input":case"select":case"textarea":n.autoFocus&&i.focus();break e;case"img":n.src?i.src=n.src:n.srcSet&&(i.srcset=n.srcSet)}}catch(s){pt(t,t.return,s)}}function Kh(t,e,n){try{var i=t.stateNode;EM(i,t.type,n,e),i[wn]=e}catch(s){pt(t,t.return,s)}}function cy(t){return t.tag===5||t.tag===3||t.tag===26||t.tag===27&&Os(t.type)||t.tag===4}function Jh(t){e:for(;;){for(;t.sibling===null;){if(t.return===null||cy(t.return))return null;t=t.return}for(t.sibling.return=t.return,t=t.sibling;t.tag!==5&&t.tag!==6&&t.tag!==18;){if(t.tag===27&&Os(t.type)||t.flags&2||t.child===null||t.tag===4)continue e;t.child.return=t,t=t.child}if(!(t.flags&2))return t.stateNode}}function Fd(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?(n.nodeType===9?n.body:n.nodeName==="HTML"?n.ownerDocument.body:n).insertBefore(t,e):(e=n.nodeType===9?n.body:n.nodeName==="HTML"?n.ownerDocument.body:n,e.appendChild(t),n=n._reactRootContainer,n!=null||e.onclick!==null||(e.onclick=Su));else if(i!==4&&(i===27&&Os(t.type)&&(n=t.stateNode,e=null),t=t.child,t!==null))for(Fd(t,e,n),t=t.sibling;t!==null;)Fd(t,e,n),t=t.sibling}function Jc(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.insertBefore(t,e):n.appendChild(t);else if(i!==4&&(i===27&&Os(t.type)&&(n=t.stateNode),t=t.child,t!==null))for(Jc(t,e,n),t=t.sibling;t!==null;)Jc(t,e,n),t=t.sibling}function uy(t){var e=t.stateNode,n=t.memoizedProps;try{for(var i=t.type,s=e.attributes;s.length;)e.removeAttributeNode(s[0]);on(e,i,n),e[cn]=t,e[wn]=n}catch(r){pt(t,t.return,r)}}var Vi=!1,Lt=!1,jh=!1,Qv=typeof WeakSet=="function"?WeakSet:Set,jt=null;function aM(t,e){if(t=t.containerInfo,Yd=ou,t=J0(t),hp(t)){if("selectionStart"in t)var n={start:t.selectionStart,end:t.selectionEnd};else e:{n=(n=t.ownerDocument)&&n.defaultView||window;var i=n.getSelection&&n.getSelection();if(i&&i.rangeCount!==0){n=i.anchorNode;var s=i.anchorOffset,r=i.focusNode;i=i.focusOffset;try{n.nodeType,r.nodeType}catch{n=null;break e}var a=0,o=-1,l=-1,c=0,f=0,p=t,h=null;t:for(;;){for(var d;p!==n||s!==0&&p.nodeType!==3||(o=a+s),p!==r||i!==0&&p.nodeType!==3||(l=a+i),p.nodeType===3&&(a+=p.nodeValue.length),(d=p.firstChild)!==null;)h=p,p=d;for(;;){if(p===t)break t;if(h===n&&++c===s&&(o=a),h===r&&++f===i&&(l=a),(d=p.nextSibling)!==null)break;p=h,h=p.parentNode}p=d}n=o===-1||l===-1?null:{start:o,end:l}}else n=null}n=n||{start:0,end:0}}else n=null;for(qd={focusedElem:t,selectionRange:n},ou=!1,jt=e;jt!==null;)if(e=jt,t=e.child,(e.subtreeFlags&1024)!==0&&t!==null)t.return=e,jt=t;else for(;jt!==null;){switch(e=jt,r=e.alternate,t=e.flags,e.tag){case 0:break;case 11:case 15:break;case 1:if((t&1024)!==0&&r!==null){t=void 0,n=e,s=r.memoizedProps,r=r.memoizedState,i=n.stateNode;try{var y=Ar(n.type,s,n.elementType===n.type);t=i.getSnapshotBeforeUpdate(y,r),i.__reactInternalSnapshotBeforeUpdate=t}catch(_){pt(n,n.return,_)}}break;case 3:if((t&1024)!==0){if(t=e.stateNode.containerInfo,n=t.nodeType,n===9)Zd(t);else if(n===1)switch(t.nodeName){case"HEAD":case"HTML":case"BODY":Zd(t);break;default:t.textContent=""}}break;case 5:case 26:case 27:case 6:case 4:case 17:break;default:if((t&1024)!==0)throw Error(Q(163))}if(t=e.sibling,t!==null){t.return=e.return,jt=t;break}jt=e.return}}function fy(t,e,n){var i=n.flags;switch(n.tag){case 0:case 11:case 15:ds(t,n),i&4&&gl(5,n);break;case 1:if(ds(t,n),i&4)if(t=n.stateNode,e===null)try{t.componentDidMount()}catch(a){pt(n,n.return,a)}else{var s=Ar(n.type,e.memoizedProps);e=e.memoizedState;try{t.componentDidUpdate(s,e,t.__reactInternalSnapshotBeforeUpdate)}catch(a){pt(n,n.return,a)}}i&64&&ay(n),i&512&&zo(n,n.return);break;case 3:if(ds(t,n),i&64&&(t=n.updateQueue,t!==null)){if(e=null,n.child!==null)switch(n.child.tag){case 27:case 5:e=n.child.stateNode;break;case 1:e=n.child.stateNode}try{hx(t,e)}catch(a){pt(n,n.return,a)}}break;case 27:e===null&&i&4&&uy(n);case 26:case 5:ds(t,n),e===null&&i&4&&ly(n),i&512&&zo(n,n.return);break;case 12:ds(t,n);break;case 13:ds(t,n),i&4&&py(t,n),i&64&&(t=n.memoizedState,t!==null&&(t=t.dehydrated,t!==null&&(n=mM.bind(null,n),UM(t,n))));break;case 22:if(i=n.memoizedState!==null||Vi,!i){e=e!==null&&e.memoizedState!==null||Lt,s=Vi;var r=Lt;Vi=i,(Lt=e)&&!r?ps(t,n,(n.subtreeFlags&8772)!==0):ds(t,n),Vi=s,Lt=r}break;case 30:break;default:ds(t,n)}}function hy(t){var e=t.alternate;e!==null&&(t.alternate=null,hy(e)),t.child=null,t.deletions=null,t.sibling=null,t.tag===5&&(e=t.stateNode,e!==null&&ap(e)),t.stateNode=null,t.return=null,t.dependencies=null,t.memoizedProps=null,t.memoizedState=null,t.pendingProps=null,t.stateNode=null,t.updateQueue=null}var Et=null,Tn=!1;function ki(t,e,n){for(n=n.child;n!==null;)dy(t,e,n),n=n.sibling}function dy(t,e,n){if(Nn&&typeof Nn.onCommitFiberUnmount=="function")try{Nn.onCommitFiberUnmount(rl,n)}catch{}switch(n.tag){case 26:Lt||Ti(n,e),ki(t,e,n),n.memoizedState?n.memoizedState.count--:n.stateNode&&(n=n.stateNode,n.parentNode.removeChild(n));break;case 27:Lt||Ti(n,e);var i=Et,s=Tn;Os(n.type)&&(Et=n.stateNode,Tn=!1),ki(t,e,n),Vo(n.stateNode),Et=i,Tn=s;break;case 5:Lt||Ti(n,e);case 6:if(i=Et,s=Tn,Et=null,ki(t,e,n),Et=i,Tn=s,Et!==null)if(Tn)try{(Et.nodeType===9?Et.body:Et.nodeName==="HTML"?Et.ownerDocument.body:Et).removeChild(n.stateNode)}catch(r){pt(n,e,r)}else try{Et.removeChild(n.stateNode)}catch(r){pt(n,e,r)}break;case 18:Et!==null&&(Tn?(t=Et,l0(t.nodeType===9?t.body:t.nodeName==="HTML"?t.ownerDocument.body:t,n.stateNode),il(t)):l0(Et,n.stateNode));break;case 4:i=Et,s=Tn,Et=n.stateNode.containerInfo,Tn=!0,ki(t,e,n),Et=i,Tn=s;break;case 0:case 11:case 14:case 15:Lt||Ps(2,n,e),Lt||Ps(4,n,e),ki(t,e,n);break;case 1:Lt||(Ti(n,e),i=n.stateNode,typeof i.componentWillUnmount=="function"&&oy(n,e,i)),ki(t,e,n);break;case 21:ki(t,e,n);break;case 22:Lt=(i=Lt)||n.memoizedState!==null,ki(t,e,n),Lt=i;break;default:ki(t,e,n)}}function py(t,e){if(e.memoizedState===null&&(t=e.alternate,t!==null&&(t=t.memoizedState,t!==null&&(t=t.dehydrated,t!==null))))try{il(t)}catch(n){pt(e,e.return,n)}}function oM(t){switch(t.tag){case 13:case 19:var e=t.stateNode;return e===null&&(e=t.stateNode=new Qv),e;case 22:return t=t.stateNode,e=t._retryCache,e===null&&(e=t._retryCache=new Qv),e;default:throw Error(Q(435,t.tag))}}function $h(t,e){var n=oM(t);e.forEach(function(i){var s=gM.bind(null,t,i);n.has(i)||(n.add(i),i.then(s,s))})}function Bn(t,e){var n=e.deletions;if(n!==null)for(var i=0;i<n.length;i++){var s=n[i],r=t,a=e,o=a;e:for(;o!==null;){switch(o.tag){case 27:if(Os(o.type)){Et=o.stateNode,Tn=!1;break e}break;case 5:Et=o.stateNode,Tn=!1;break e;case 3:case 4:Et=o.stateNode.containerInfo,Tn=!0;break e}o=o.return}if(Et===null)throw Error(Q(160));dy(r,a,s),Et=null,Tn=!1,r=s.alternate,r!==null&&(r.return=null),s.return=null}if(e.subtreeFlags&13878)for(e=e.child;e!==null;)my(e,t),e=e.sibling}var ui=null;function my(t,e){var n=t.alternate,i=t.flags;switch(t.tag){case 0:case 11:case 14:case 15:Bn(e,t),In(t),i&4&&(Ps(3,t,t.return),gl(3,t),Ps(5,t,t.return));break;case 1:Bn(e,t),In(t),i&512&&(Lt||n===null||Ti(n,n.return)),i&64&&Vi&&(t=t.updateQueue,t!==null&&(i=t.callbacks,i!==null&&(n=t.shared.hiddenCallbacks,t.shared.hiddenCallbacks=n===null?i:n.concat(i))));break;case 26:var s=ui;if(Bn(e,t),In(t),i&512&&(Lt||n===null||Ti(n,n.return)),i&4){var r=n!==null?n.memoizedState:null;if(i=t.memoizedState,n===null)if(i===null)if(t.stateNode===null){e:{i=t.type,n=t.memoizedProps,s=s.ownerDocument||s;t:switch(i){case"title":r=s.getElementsByTagName("title")[0],(!r||r[ll]||r[cn]||r.namespaceURI==="http://www.w3.org/2000/svg"||r.hasAttribute("itemprop"))&&(r=s.createElement(i),s.head.insertBefore(r,s.querySelector("head > title"))),on(r,i,n),r[cn]=t,$t(r),i=r;break e;case"link":var a=d0("link","href",s).get(i+(n.href||""));if(a){for(var o=0;o<a.length;o++)if(r=a[o],r.getAttribute("href")===(n.href==null||n.href===""?null:n.href)&&r.getAttribute("rel")===(n.rel==null?null:n.rel)&&r.getAttribute("title")===(n.title==null?null:n.title)&&r.getAttribute("crossorigin")===(n.crossOrigin==null?null:n.crossOrigin)){a.splice(o,1);break t}}r=s.createElement(i),on(r,i,n),s.head.appendChild(r);break;case"meta":if(a=d0("meta","content",s).get(i+(n.content||""))){for(o=0;o<a.length;o++)if(r=a[o],r.getAttribute("content")===(n.content==null?null:""+n.content)&&r.getAttribute("name")===(n.name==null?null:n.name)&&r.getAttribute("property")===(n.property==null?null:n.property)&&r.getAttribute("http-equiv")===(n.httpEquiv==null?null:n.httpEquiv)&&r.getAttribute("charset")===(n.charSet==null?null:n.charSet)){a.splice(o,1);break t}}r=s.createElement(i),on(r,i,n),s.head.appendChild(r);break;default:throw Error(Q(468,i))}r[cn]=t,$t(r),i=r}t.stateNode=i}else p0(s,t.type,t.stateNode);else t.stateNode=h0(s,i,t.memoizedProps);else r!==i?(r===null?n.stateNode!==null&&(n=n.stateNode,n.parentNode.removeChild(n)):r.count--,i===null?p0(s,t.type,t.stateNode):h0(s,i,t.memoizedProps)):i===null&&t.stateNode!==null&&Kh(t,t.memoizedProps,n.memoizedProps)}break;case 27:Bn(e,t),In(t),i&512&&(Lt||n===null||Ti(n,n.return)),n!==null&&i&4&&Kh(t,t.memoizedProps,n.memoizedProps);break;case 5:if(Bn(e,t),In(t),i&512&&(Lt||n===null||Ti(n,n.return)),t.flags&32){s=t.stateNode;try{Ea(s,"")}catch(d){pt(t,t.return,d)}}i&4&&t.stateNode!=null&&(s=t.memoizedProps,Kh(t,s,n!==null?n.memoizedProps:s)),i&1024&&(jh=!0);break;case 6:if(Bn(e,t),In(t),i&4){if(t.stateNode===null)throw Error(Q(162));i=t.memoizedProps,n=t.stateNode;try{n.nodeValue=i}catch(d){pt(t,t.return,d)}}break;case 3:if(Uc=null,s=ui,ui=su(e.containerInfo),Bn(e,t),ui=s,In(t),i&4&&n!==null&&n.memoizedState.isDehydrated)try{il(e.containerInfo)}catch(d){pt(t,t.return,d)}jh&&(jh=!1,gy(t));break;case 4:i=ui,ui=su(t.stateNode.containerInfo),Bn(e,t),In(t),ui=i;break;case 12:Bn(e,t),In(t);break;case 13:Bn(e,t),In(t),t.child.flags&8192&&t.memoizedState!==null!=(n!==null&&n.memoizedState!==null)&&(zp=wi()),i&4&&(i=t.updateQueue,i!==null&&(t.updateQueue=null,$h(t,i)));break;case 22:s=t.memoizedState!==null;var l=n!==null&&n.memoizedState!==null,c=Vi,f=Lt;if(Vi=c||s,Lt=f||l,Bn(e,t),Lt=f,Vi=c,In(t),i&8192)e:for(e=t.stateNode,e._visibility=s?e._visibility&-2:e._visibility|1,s&&(n===null||l||Vi||Lt||ur(t)),n=null,e=t;;){if(e.tag===5||e.tag===26){if(n===null){l=n=e;try{if(r=l.stateNode,s)a=r.style,typeof a.setProperty=="function"?a.setProperty("display","none","important"):a.display="none";else{o=l.stateNode;var p=l.memoizedProps.style,h=p!=null&&p.hasOwnProperty("display")?p.display:null;o.style.display=h==null||typeof h=="boolean"?"":(""+h).trim()}}catch(d){pt(l,l.return,d)}}}else if(e.tag===6){if(n===null){l=e;try{l.stateNode.nodeValue=s?"":l.memoizedProps}catch(d){pt(l,l.return,d)}}}else if((e.tag!==22&&e.tag!==23||e.memoizedState===null||e===t)&&e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break e;for(;e.sibling===null;){if(e.return===null||e.return===t)break e;n===e&&(n=null),e=e.return}n===e&&(n=null),e.sibling.return=e.return,e=e.sibling}i&4&&(i=t.updateQueue,i!==null&&(n=i.retryQueue,n!==null&&(i.retryQueue=null,$h(t,n))));break;case 19:Bn(e,t),In(t),i&4&&(i=t.updateQueue,i!==null&&(t.updateQueue=null,$h(t,i)));break;case 30:break;case 21:break;default:Bn(e,t),In(t)}}function In(t){var e=t.flags;if(e&2){try{for(var n,i=t.return;i!==null;){if(cy(i)){n=i;break}i=i.return}if(n==null)throw Error(Q(160));switch(n.tag){case 27:var s=n.stateNode,r=Jh(t);Jc(t,r,s);break;case 5:var a=n.stateNode;n.flags&32&&(Ea(a,""),n.flags&=-33);var o=Jh(t);Jc(t,o,a);break;case 3:case 4:var l=n.stateNode.containerInfo,c=Jh(t);Fd(t,c,l);break;default:throw Error(Q(161))}}catch(f){pt(t,t.return,f)}t.flags&=-3}e&4096&&(t.flags&=-4097)}function gy(t){if(t.subtreeFlags&1024)for(t=t.child;t!==null;){var e=t;gy(e),e.tag===5&&e.flags&1024&&e.stateNode.reset(),t=t.sibling}}function ds(t,e){if(e.subtreeFlags&8772)for(e=e.child;e!==null;)fy(t,e.alternate,e),e=e.sibling}function ur(t){for(t=t.child;t!==null;){var e=t;switch(e.tag){case 0:case 11:case 14:case 15:Ps(4,e,e.return),ur(e);break;case 1:Ti(e,e.return);var n=e.stateNode;typeof n.componentWillUnmount=="function"&&oy(e,e.return,n),ur(e);break;case 27:Vo(e.stateNode);case 26:case 5:Ti(e,e.return),ur(e);break;case 22:e.memoizedState===null&&ur(e);break;case 30:ur(e);break;default:ur(e)}t=t.sibling}}function ps(t,e,n){for(n=n&&(e.subtreeFlags&8772)!==0,e=e.child;e!==null;){var i=e.alternate,s=t,r=e,a=r.flags;switch(r.tag){case 0:case 11:case 15:ps(s,r,n),gl(4,r);break;case 1:if(ps(s,r,n),i=r,s=i.stateNode,typeof s.componentDidMount=="function")try{s.componentDidMount()}catch(c){pt(i,i.return,c)}if(i=r,s=i.updateQueue,s!==null){var o=i.stateNode;try{var l=s.shared.hiddenCallbacks;if(l!==null)for(s.shared.hiddenCallbacks=null,s=0;s<l.length;s++)fx(l[s],o)}catch(c){pt(i,i.return,c)}}n&&a&64&&ay(r),zo(r,r.return);break;case 27:uy(r);case 26:case 5:ps(s,r,n),n&&i===null&&a&4&&ly(r),zo(r,r.return);break;case 12:ps(s,r,n);break;case 13:ps(s,r,n),n&&a&4&&py(s,r);break;case 22:r.memoizedState===null&&ps(s,r,n),zo(r,r.return);break;case 30:break;default:ps(s,r,n)}e=e.sibling}}function Lp(t,e){var n=null;t!==null&&t.memoizedState!==null&&t.memoizedState.cachePool!==null&&(n=t.memoizedState.cachePool.pool),t=null,e.memoizedState!==null&&e.memoizedState.cachePool!==null&&(t=e.memoizedState.cachePool.pool),t!==n&&(t!=null&&t.refCount++,n!=null&&hl(n))}function Np(t,e){t=null,e.alternate!==null&&(t=e.alternate.memoizedState.cache),e=e.memoizedState.cache,e!==t&&(e.refCount++,t!=null&&hl(t))}function Mi(t,e,n,i){if(e.subtreeFlags&10256)for(e=e.child;e!==null;)vy(t,e,n,i),e=e.sibling}function vy(t,e,n,i){var s=e.flags;switch(e.tag){case 0:case 11:case 15:Mi(t,e,n,i),s&2048&&gl(9,e);break;case 1:Mi(t,e,n,i);break;case 3:Mi(t,e,n,i),s&2048&&(t=null,e.alternate!==null&&(t=e.alternate.memoizedState.cache),e=e.memoizedState.cache,e!==t&&(e.refCount++,t!=null&&hl(t)));break;case 12:if(s&2048){Mi(t,e,n,i),t=e.stateNode;try{var r=e.memoizedProps,a=r.id,o=r.onPostCommit;typeof o=="function"&&o(a,e.alternate===null?"mount":"update",t.passiveEffectDuration,-0)}catch(l){pt(e,e.return,l)}}else Mi(t,e,n,i);break;case 13:Mi(t,e,n,i);break;case 23:break;case 22:r=e.stateNode,a=e.alternate,e.memoizedState!==null?r._visibility&2?Mi(t,e,n,i):Ho(t,e):r._visibility&2?Mi(t,e,n,i):(r._visibility|=2,ea(t,e,n,i,(e.subtreeFlags&10256)!==0)),s&2048&&Lp(a,e);break;case 24:Mi(t,e,n,i),s&2048&&Np(e.alternate,e);break;default:Mi(t,e,n,i)}}function ea(t,e,n,i,s){for(s=s&&(e.subtreeFlags&10256)!==0,e=e.child;e!==null;){var r=t,a=e,o=n,l=i,c=a.flags;switch(a.tag){case 0:case 11:case 15:ea(r,a,o,l,s),gl(8,a);break;case 23:break;case 22:var f=a.stateNode;a.memoizedState!==null?f._visibility&2?ea(r,a,o,l,s):Ho(r,a):(f._visibility|=2,ea(r,a,o,l,s)),s&&c&2048&&Lp(a.alternate,a);break;case 24:ea(r,a,o,l,s),s&&c&2048&&Np(a.alternate,a);break;default:ea(r,a,o,l,s)}e=e.sibling}}function Ho(t,e){if(e.subtreeFlags&10256)for(e=e.child;e!==null;){var n=t,i=e,s=i.flags;switch(i.tag){case 22:Ho(n,i),s&2048&&Lp(i.alternate,i);break;case 24:Ho(n,i),s&2048&&Np(i.alternate,i);break;default:Ho(n,i)}e=e.sibling}}var Ro=8192;function Jr(t){if(t.subtreeFlags&Ro)for(t=t.child;t!==null;)xy(t),t=t.sibling}function xy(t){switch(t.tag){case 26:Jr(t),t.flags&Ro&&t.memoizedState!==null&&WM(ui,t.memoizedState,t.memoizedProps);break;case 5:Jr(t);break;case 3:case 4:var e=ui;ui=su(t.stateNode.containerInfo),Jr(t),ui=e;break;case 22:t.memoizedState===null&&(e=t.alternate,e!==null&&e.memoizedState!==null?(e=Ro,Ro=16777216,Jr(t),Ro=e):Jr(t));break;default:Jr(t)}}function yy(t){var e=t.alternate;if(e!==null&&(t=e.child,t!==null)){e.child=null;do e=t.sibling,t.sibling=null,t=e;while(t!==null)}}function Mo(t){var e=t.deletions;if((t.flags&16)!==0){if(e!==null)for(var n=0;n<e.length;n++){var i=e[n];jt=i,Ay(i,t)}yy(t)}if(t.subtreeFlags&10256)for(t=t.child;t!==null;)_y(t),t=t.sibling}function _y(t){switch(t.tag){case 0:case 11:case 15:Mo(t),t.flags&2048&&Ps(9,t,t.return);break;case 3:Mo(t);break;case 12:Mo(t);break;case 22:var e=t.stateNode;t.memoizedState!==null&&e._visibility&2&&(t.return===null||t.return.tag!==13)?(e._visibility&=-3,Rc(t)):Mo(t);break;default:Mo(t)}}function Rc(t){var e=t.deletions;if((t.flags&16)!==0){if(e!==null)for(var n=0;n<e.length;n++){var i=e[n];jt=i,Ay(i,t)}yy(t)}for(t=t.child;t!==null;){switch(e=t,e.tag){case 0:case 11:case 15:Ps(8,e,e.return),Rc(e);break;case 22:n=e.stateNode,n._visibility&2&&(n._visibility&=-3,Rc(e));break;default:Rc(e)}t=t.sibling}}function Ay(t,e){for(;jt!==null;){var n=jt;switch(n.tag){case 0:case 11:case 15:Ps(8,n,e);break;case 23:case 22:if(n.memoizedState!==null&&n.memoizedState.cachePool!==null){var i=n.memoizedState.cachePool.pool;i!=null&&i.refCount++}break;case 24:hl(n.memoizedState.cache)}if(i=n.child,i!==null)i.return=n,jt=i;else e:for(n=t;jt!==null;){i=jt;var s=i.sibling,r=i.return;if(hy(i),i===n){jt=null;break e}if(s!==null){s.return=r,jt=s;break e}jt=r}}}var lM={getCacheForType:function(t){var e=un(kt),n=e.data.get(t);return n===void 0&&(n=t(),e.data.set(t,n)),n}},cM=typeof WeakMap=="function"?WeakMap:Map,ot=0,gt=null,We=null,Ke=0,at=0,Pn=null,Ms=!1,Na=!1,Op=!1,es=0,Ut=0,Ls=0,gr=0,Fp=0,ni=0,Ra=0,Go=null,bn=null,zd=!1,zp=0,jc=1/0,$c=null,Cs=null,an=0,Rs=null,Da=null,Aa=0,Hd=0,Gd=null,Sy=null,ko=0,kd=null;function Fn(){if((ot&2)!==0&&Ke!==0)return Ke&-Ke;if(De.T!==null){var t=Ta;return t!==0?t:Gp()}return I0()}function My(){ni===0&&(ni=(Ke&536870912)===0||nt?R0():536870912);var t=ii.current;return t!==null&&(t.flags|=32),ni}function zn(t,e,n){(t===gt&&(at===2||at===9)||t.cancelPendingCommit!==null)&&(Ua(t,0),Es(t,Ke,ni,!1)),ol(t,n),((ot&2)===0||t!==gt)&&(t===gt&&((ot&2)===0&&(gr|=n),Ut===4&&Es(t,Ke,ni,!1)),Di(t))}function Ey(t,e,n){if((ot&6)!==0)throw Error(Q(327));var i=!n&&(e&124)===0&&(e&t.expiredLanes)===0||al(t,e),s=i?hM(t,e):ed(t,e,!0),r=i;do{if(s===0){Na&&!i&&Es(t,e,0,!1);break}else{if(n=t.current.alternate,r&&!uM(n)){s=ed(t,e,!1),r=!1;continue}if(s===2){if(r=e,t.errorRecoveryDisabledLanes&r)var a=0;else a=t.pendingLanes&-536870913,a=a!==0?a:a&536870912?536870912:0;if(a!==0){e=a;e:{var o=t;s=Go;var l=o.current.memoizedState.isDehydrated;if(l&&(Ua(o,a).flags|=256),a=ed(o,a,!1),a!==2){if(Op&&!l){o.errorRecoveryDisabledLanes|=r,gr|=r,s=4;break e}r=bn,bn=s,r!==null&&(bn===null?bn=r:bn.push.apply(bn,r))}s=a}if(r=!1,s!==2)continue}}if(s===1){Ua(t,0),Es(t,e,0,!0);break}e:{switch(i=t,r=s,r){case 0:case 1:throw Error(Q(345));case 4:if((e&4194048)!==e)break;case 6:Es(i,e,ni,!Ms);break e;case 2:bn=null;break;case 3:case 5:break;default:throw Error(Q(329))}if((e&62914560)===e&&(s=zp+300-wi(),10<s)){if(Es(i,e,ni,!Ms),cu(i,0,!0)!==0)break e;i.timeoutHandle=Vy(Zv.bind(null,i,n,bn,$c,zd,e,ni,gr,Ra,Ms,r,2,-0,0),s);break e}Zv(i,n,bn,$c,zd,e,ni,gr,Ra,Ms,r,0,-0,0)}}break}while(!0);Di(t)}function Zv(t,e,n,i,s,r,a,o,l,c,f,p,h,d){if(t.timeoutHandle=-1,p=e.subtreeFlags,(p&8192||(p&16785408)===16785408)&&($o={stylesheets:null,count:0,unsuspend:VM},xy(e),p=XM(),p!==null)){t.cancelPendingCommit=p(Jv.bind(null,t,e,r,n,i,s,a,o,l,f,1,h,d)),Es(t,r,a,!c);return}Jv(t,e,r,n,i,s,a,o,l)}function uM(t){for(var e=t;;){var n=e.tag;if((n===0||n===11||n===15)&&e.flags&16384&&(n=e.updateQueue,n!==null&&(n=n.stores,n!==null)))for(var i=0;i<n.length;i++){var s=n[i],r=s.getSnapshot;s=s.value;try{if(!Hn(r(),s))return!1}catch{return!1}}if(n=e.child,e.subtreeFlags&16384&&n!==null)n.return=e,e=n;else{if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function Es(t,e,n,i){e&=~Fp,e&=~gr,t.suspendedLanes|=e,t.pingedLanes&=~e,i&&(t.warmLanes|=e),i=t.expirationTimes;for(var s=e;0<s;){var r=31-On(s),a=1<<r;i[r]=-1,s&=~a}n!==0&&U0(t,n,e)}function yu(){return(ot&6)===0?(vl(0,!1),!1):!0}function Hp(){if(We!==null){if(at===0)var t=We.return;else t=We,qi=Tr=null,bp(t),_a=null,Ko=0,t=We;for(;t!==null;)ry(t.alternate,t),t=t.return;We=null}}function Ua(t,e){var n=t.timeoutHandle;n!==-1&&(t.timeoutHandle=-1,bM(n)),n=t.cancelPendingCommit,n!==null&&(t.cancelPendingCommit=null,n()),Hp(),gt=t,We=n=Zi(t.current,null),Ke=e,at=0,Pn=null,Ms=!1,Na=al(t,e),Op=!1,Ra=ni=Fp=gr=Ls=Ut=0,bn=Go=null,zd=!1,(e&8)!==0&&(e|=e&32);var i=t.entangledLanes;if(i!==0)for(t=t.entanglements,i&=e;0<i;){var s=31-On(i),r=1<<s;e|=t[s],i&=~r}return es=e,du(),n}function Ty(t,e){Ge=null,De.H=Yc,e===dl||e===mu?(e=wv(),at=3):e===cx?(e=wv(),at=4):at=e===$x?8:e!==null&&typeof e=="object"&&typeof e.then=="function"?6:1,Pn=e,We===null&&(Ut=1,Zc(t,ti(e,t.current)))}function by(){var t=De.H;return De.H=Yc,t===null?Yc:t}function wy(){var t=De.A;return De.A=lM,t}function Vd(){Ut=4,Ms||(Ke&4194048)!==Ke&&ii.current!==null||(Na=!0),(Ls&134217727)===0&&(gr&134217727)===0||gt===null||Es(gt,Ke,ni,!1)}function ed(t,e,n){var i=ot;ot|=2;var s=by(),r=wy();(gt!==t||Ke!==e)&&($c=null,Ua(t,e)),e=!1;var a=Ut;e:do try{if(at!==0&&We!==null){var o=We,l=Pn;switch(at){case 8:Hp(),a=6;break e;case 3:case 2:case 9:case 6:ii.current===null&&(e=!0);var c=at;if(at=0,Pn=null,da(t,o,l,c),n&&Na){a=0;break e}break;default:c=at,at=0,Pn=null,da(t,o,l,c)}}fM(),a=Ut;break}catch(f){Ty(t,f)}while(!0);return e&&t.shellSuspendCounter++,qi=Tr=null,ot=i,De.H=s,De.A=r,We===null&&(gt=null,Ke=0,du()),a}function fM(){for(;We!==null;)Cy(We)}function hM(t,e){var n=ot;ot|=2;var i=by(),s=wy();gt!==t||Ke!==e?($c=null,jc=wi()+500,Ua(t,e)):Na=al(t,e);e:do try{if(at!==0&&We!==null){e=We;var r=Pn;t:switch(at){case 1:at=0,Pn=null,da(t,e,r,1);break;case 2:case 9:if(bv(r)){at=0,Pn=null,Kv(e);break}e=function(){at!==2&&at!==9||gt!==t||(at=7),Di(t)},r.then(e,e);break e;case 3:at=7;break e;case 4:at=5;break e;case 7:bv(r)?(at=0,Pn=null,Kv(e)):(at=0,Pn=null,da(t,e,r,7));break;case 5:var a=null;switch(We.tag){case 26:a=We.memoizedState;case 5:case 27:var o=We;if(!a||qy(a)){at=0,Pn=null;var l=o.sibling;if(l!==null)We=l;else{var c=o.return;c!==null?(We=c,_u(c)):We=null}break t}}at=0,Pn=null,da(t,e,r,5);break;case 6:at=0,Pn=null,da(t,e,r,6);break;case 8:Hp(),Ut=6;break e;default:throw Error(Q(462))}}dM();break}catch(f){Ty(t,f)}while(!0);return qi=Tr=null,De.H=i,De.A=s,ot=n,We!==null?0:(gt=null,Ke=0,du(),Ut)}function dM(){for(;We!==null&&!LS();)Cy(We)}function Cy(t){var e=sy(t.alternate,t,es);t.memoizedProps=t.pendingProps,e===null?_u(t):We=e}function Kv(t){var e=t,n=e.alternate;switch(e.tag){case 15:case 0:e=Vv(n,e,e.pendingProps,e.type,void 0,Ke);break;case 11:e=Vv(n,e,e.pendingProps,e.type.render,e.ref,Ke);break;case 5:bp(e);default:ry(n,e),e=We=rx(e,es),e=sy(n,e,es)}t.memoizedProps=t.pendingProps,e===null?_u(t):We=e}function da(t,e,n,i){qi=Tr=null,bp(e),_a=null,Ko=0;var s=e.return;try{if(nM(t,s,e,n,Ke)){Ut=1,Zc(t,ti(n,t.current)),We=null;return}}catch(r){if(s!==null)throw We=s,r;Ut=1,Zc(t,ti(n,t.current)),We=null;return}e.flags&32768?(nt||i===1?t=!0:Na||(Ke&536870912)!==0?t=!1:(Ms=t=!0,(i===2||i===9||i===3||i===6)&&(i=ii.current,i!==null&&i.tag===13&&(i.flags|=16384))),Ry(e,t)):_u(e)}function _u(t){var e=t;do{if((e.flags&32768)!==0){Ry(e,Ms);return}t=e.return;var n=sM(e.alternate,e,es);if(n!==null){We=n;return}if(e=e.sibling,e!==null){We=e;return}We=e=t}while(e!==null);Ut===0&&(Ut=5)}function Ry(t,e){do{var n=rM(t.alternate,t);if(n!==null){n.flags&=32767,We=n;return}if(n=t.return,n!==null&&(n.flags|=32768,n.subtreeFlags=0,n.deletions=null),!e&&(t=t.sibling,t!==null)){We=t;return}We=t=n}while(t!==null);Ut=6,We=null}function Jv(t,e,n,i,s,r,a,o,l){t.cancelPendingCommit=null;do Au();while(an!==0);if((ot&6)!==0)throw Error(Q(327));if(e!==null){if(e===t.current)throw Error(Q(177));if(r=e.lanes|e.childLanes,r|=dp,XS(t,n,r,a,o,l),t===gt&&(We=gt=null,Ke=0),Da=e,Rs=t,Aa=n,Hd=r,Gd=s,Sy=i,(e.subtreeFlags&10256)!==0||(e.flags&10256)!==0?(t.callbackNode=null,t.callbackPriority=0,vM(Nc,function(){return Py(!0),null})):(t.callbackNode=null,t.callbackPriority=0),i=(e.flags&13878)!==0,(e.subtreeFlags&13878)!==0||i){i=De.T,De.T=null,s=it.p,it.p=2,a=ot,ot|=4;try{aM(t,e,n)}finally{ot=a,it.p=s,De.T=i}}an=1,Dy(),Uy(),By()}}function Dy(){if(an===1){an=0;var t=Rs,e=Da,n=(e.flags&13878)!==0;if((e.subtreeFlags&13878)!==0||n){n=De.T,De.T=null;var i=it.p;it.p=2;var s=ot;ot|=4;try{my(e,t);var r=qd,a=J0(t.containerInfo),o=r.focusedElem,l=r.selectionRange;if(a!==o&&o&&o.ownerDocument&&K0(o.ownerDocument.documentElement,o)){if(l!==null&&hp(o)){var c=l.start,f=l.end;if(f===void 0&&(f=c),"selectionStart"in o)o.selectionStart=c,o.selectionEnd=Math.min(f,o.value.length);else{var p=o.ownerDocument||document,h=p&&p.defaultView||window;if(h.getSelection){var d=h.getSelection(),y=o.textContent.length,_=Math.min(l.start,y),m=l.end===void 0?_:Math.min(l.end,y);!d.extend&&_>m&&(a=m,m=_,_=a);var u=xv(o,_),g=xv(o,m);if(u&&g&&(d.rangeCount!==1||d.anchorNode!==u.node||d.anchorOffset!==u.offset||d.focusNode!==g.node||d.focusOffset!==g.offset)){var v=p.createRange();v.setStart(u.node,u.offset),d.removeAllRanges(),_>m?(d.addRange(v),d.extend(g.node,g.offset)):(v.setEnd(g.node,g.offset),d.addRange(v))}}}}for(p=[],d=o;d=d.parentNode;)d.nodeType===1&&p.push({element:d,left:d.scrollLeft,top:d.scrollTop});for(typeof o.focus=="function"&&o.focus(),o=0;o<p.length;o++){var x=p[o];x.element.scrollLeft=x.left,x.element.scrollTop=x.top}}ou=!!Yd,qd=Yd=null}finally{ot=s,it.p=i,De.T=n}}t.current=e,an=2}}function Uy(){if(an===2){an=0;var t=Rs,e=Da,n=(e.flags&8772)!==0;if((e.subtreeFlags&8772)!==0||n){n=De.T,De.T=null;var i=it.p;it.p=2;var s=ot;ot|=4;try{fy(t,e.alternate,e)}finally{ot=s,it.p=i,De.T=n}}an=3}}function By(){if(an===4||an===3){an=0,NS();var t=Rs,e=Da,n=Aa,i=Sy;(e.subtreeFlags&10256)!==0||(e.flags&10256)!==0?an=5:(an=0,Da=Rs=null,Iy(t,t.pendingLanes));var s=t.pendingLanes;if(s===0&&(Cs=null),rp(n),e=e.stateNode,Nn&&typeof Nn.onCommitFiberRoot=="function")try{Nn.onCommitFiberRoot(rl,e,void 0,(e.current.flags&128)===128)}catch{}if(i!==null){e=De.T,s=it.p,it.p=2,De.T=null;try{for(var r=t.onRecoverableError,a=0;a<i.length;a++){var o=i[a];r(o.value,{componentStack:o.stack})}}finally{De.T=e,it.p=s}}(Aa&3)!==0&&Au(),Di(t),s=t.pendingLanes,(n&4194090)!==0&&(s&42)!==0?t===kd?ko++:(ko=0,kd=t):ko=0,vl(0,!1)}}function Iy(t,e){(t.pooledCacheLanes&=e)===0&&(e=t.pooledCache,e!=null&&(t.pooledCache=null,hl(e)))}function Au(t){return Dy(),Uy(),By(),Py(t)}function Py(){if(an!==5)return!1;var t=Rs,e=Hd;Hd=0;var n=rp(Aa),i=De.T,s=it.p;try{it.p=32>n?32:n,De.T=null,n=Gd,Gd=null;var r=Rs,a=Aa;if(an=0,Da=Rs=null,Aa=0,(ot&6)!==0)throw Error(Q(331));var o=ot;if(ot|=4,_y(r.current),vy(r,r.current,a,n),ot=o,vl(0,!1),Nn&&typeof Nn.onPostCommitFiberRoot=="function")try{Nn.onPostCommitFiberRoot(rl,r)}catch{}return!0}finally{it.p=s,De.T=i,Iy(t,e)}}function jv(t,e,n){e=ti(n,e),e=Ld(t.stateNode,e,2),t=ws(t,e,2),t!==null&&(ol(t,2),Di(t))}function pt(t,e,n){if(t.tag===3)jv(t,t,n);else for(;e!==null;){if(e.tag===3){jv(e,t,n);break}else if(e.tag===1){var i=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(Cs===null||!Cs.has(i))){t=ti(n,t),n=Jx(2),i=ws(e,n,2),i!==null&&(jx(n,i,e,t),ol(i,2),Di(i));break}}e=e.return}}function td(t,e,n){var i=t.pingCache;if(i===null){i=t.pingCache=new cM;var s=new Set;i.set(e,s)}else s=i.get(e),s===void 0&&(s=new Set,i.set(e,s));s.has(n)||(Op=!0,s.add(n),t=pM.bind(null,t,e,n),e.then(t,t))}function pM(t,e,n){var i=t.pingCache;i!==null&&i.delete(e),t.pingedLanes|=t.suspendedLanes&n,t.warmLanes&=~n,gt===t&&(Ke&n)===n&&(Ut===4||Ut===3&&(Ke&62914560)===Ke&&300>wi()-zp?(ot&2)===0&&Ua(t,0):Fp|=n,Ra===Ke&&(Ra=0)),Di(t)}function Ly(t,e){e===0&&(e=D0()),t=La(t,e),t!==null&&(ol(t,e),Di(t))}function mM(t){var e=t.memoizedState,n=0;e!==null&&(n=e.retryLane),Ly(t,n)}function gM(t,e){var n=0;switch(t.tag){case 13:var i=t.stateNode,s=t.memoizedState;s!==null&&(n=s.retryLane);break;case 19:i=t.stateNode;break;case 22:i=t.stateNode._retryCache;break;default:throw Error(Q(314))}i!==null&&i.delete(e),Ly(t,n)}function vM(t,e){return ip(t,e)}var eu=null,ta=null,Wd=!1,tu=!1,nd=!1,vr=0;function Di(t){t!==ta&&t.next===null&&(ta===null?eu=ta=t:ta=ta.next=t),tu=!0,Wd||(Wd=!0,yM())}function vl(t,e){if(!nd&&tu){nd=!0;do for(var n=!1,i=eu;i!==null;){if(!e)if(t!==0){var s=i.pendingLanes;if(s===0)var r=0;else{var a=i.suspendedLanes,o=i.pingedLanes;r=(1<<31-On(42|t)+1)-1,r&=s&~(a&~o),r=r&201326741?r&201326741|1:r?r|2:0}r!==0&&(n=!0,$v(i,r))}else r=Ke,r=cu(i,i===gt?r:0,i.cancelPendingCommit!==null||i.timeoutHandle!==-1),(r&3)===0||al(i,r)||(n=!0,$v(i,r));i=i.next}while(n);nd=!1}}function xM(){Ny()}function Ny(){tu=Wd=!1;var t=0;vr!==0&&(TM()&&(t=vr),vr=0);for(var e=wi(),n=null,i=eu;i!==null;){var s=i.next,r=Oy(i,e);r===0?(i.next=null,n===null?eu=s:n.next=s,s===null&&(ta=n)):(n=i,(t!==0||(r&3)!==0)&&(tu=!0)),i=s}vl(t,!1)}function Oy(t,e){for(var n=t.suspendedLanes,i=t.pingedLanes,s=t.expirationTimes,r=t.pendingLanes&-62914561;0<r;){var a=31-On(r),o=1<<a,l=s[a];l===-1?((o&n)===0||(o&i)!==0)&&(s[a]=WS(o,e)):l<=e&&(t.expiredLanes|=o),r&=~o}if(e=gt,n=Ke,n=cu(t,t===e?n:0,t.cancelPendingCommit!==null||t.timeoutHandle!==-1),i=t.callbackNode,n===0||t===e&&(at===2||at===9)||t.cancelPendingCommit!==null)return i!==null&&i!==null&&Rh(i),t.callbackNode=null,t.callbackPriority=0;if((n&3)===0||al(t,n)){if(e=n&-n,e===t.callbackPriority)return e;switch(i!==null&&Rh(i),rp(n)){case 2:case 8:n=w0;break;case 32:n=Nc;break;case 268435456:n=C0;break;default:n=Nc}return i=Fy.bind(null,t),n=ip(n,i),t.callbackPriority=e,t.callbackNode=n,e}return i!==null&&i!==null&&Rh(i),t.callbackPriority=2,t.callbackNode=null,2}function Fy(t,e){if(an!==0&&an!==5)return t.callbackNode=null,t.callbackPriority=0,null;var n=t.callbackNode;if(Au(!0)&&t.callbackNode!==n)return null;var i=Ke;return i=cu(t,t===gt?i:0,t.cancelPendingCommit!==null||t.timeoutHandle!==-1),i===0?null:(Ey(t,i,e),Oy(t,wi()),t.callbackNode!=null&&t.callbackNode===n?Fy.bind(null,t):null)}function $v(t,e){if(Au())return null;Ey(t,e,!0)}function yM(){wM(function(){(ot&6)!==0?ip(b0,xM):Ny()})}function Gp(){return vr===0&&(vr=R0()),vr}function e0(t){return t==null||typeof t=="symbol"||typeof t=="boolean"?null:typeof t=="function"?t:Ac(""+t)}function t0(t,e){var n=e.ownerDocument.createElement("input");return n.name=e.name,n.value=e.value,t.id&&n.setAttribute("form",t.id),e.parentNode.insertBefore(n,e),t=new FormData(t),n.parentNode.removeChild(n),t}function _M(t,e,n,i,s){if(e==="submit"&&n&&n.stateNode===s){var r=e0((s[wn]||null).action),a=i.submitter;a&&(e=(e=a[wn]||null)?e0(e.formAction):a.getAttribute("formAction"),e!==null&&(r=e,a=null));var o=new uu("action","action",null,i,s);t.push({event:o,listeners:[{instance:null,listener:function(){if(i.defaultPrevented){if(vr!==0){var l=a?t0(s,a):new FormData(s);Id(n,{pending:!0,data:l,method:s.method,action:r},null,l)}}else typeof r=="function"&&(o.preventDefault(),l=a?t0(s,a):new FormData(s),Id(n,{pending:!0,data:l,method:s.method,action:r},r,l))},currentTarget:s}]})}}for(mc=0;mc<Ad.length;mc++)gc=Ad[mc],n0=gc.toLowerCase(),i0=gc[0].toUpperCase()+gc.slice(1),hi(n0,"on"+i0);var gc,n0,i0,mc;hi($0,"onAnimationEnd");hi(ex,"onAnimationIteration");hi(tx,"onAnimationStart");hi("dblclick","onDoubleClick");hi("focusin","onFocus");hi("focusout","onBlur");hi(z1,"onTransitionRun");hi(H1,"onTransitionStart");hi(G1,"onTransitionCancel");hi(nx,"onTransitionEnd");Ma("onMouseEnter",["mouseout","mouseover"]);Ma("onMouseLeave",["mouseout","mouseover"]);Ma("onPointerEnter",["pointerout","pointerover"]);Ma("onPointerLeave",["pointerout","pointerover"]);Sr("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));Sr("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));Sr("onBeforeInput",["compositionend","keypress","textInput","paste"]);Sr("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));Sr("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));Sr("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var Jo="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),AM=new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(Jo));function zy(t,e){e=(e&4)!==0;for(var n=0;n<t.length;n++){var i=t[n],s=i.event;i=i.listeners;e:{var r=void 0;if(e)for(var a=i.length-1;0<=a;a--){var o=i[a],l=o.instance,c=o.currentTarget;if(o=o.listener,l!==r&&s.isPropagationStopped())break e;r=o,s.currentTarget=c;try{r(s)}catch(f){Qc(f)}s.currentTarget=null,r=l}else for(a=0;a<i.length;a++){if(o=i[a],l=o.instance,c=o.currentTarget,o=o.listener,l!==r&&s.isPropagationStopped())break e;r=o,s.currentTarget=c;try{r(s)}catch(f){Qc(f)}s.currentTarget=null,r=l}}}}function Ve(t,e){var n=e[pd];n===void 0&&(n=e[pd]=new Set);var i=t+"__bubble";n.has(i)||(Hy(e,t,2,!1),n.add(i))}function id(t,e,n){var i=0;e&&(i|=4),Hy(n,t,i,e)}var vc="_reactListening"+Math.random().toString(36).slice(2);function kp(t){if(!t[vc]){t[vc]=!0,P0.forEach(function(n){n!=="selectionchange"&&(AM.has(n)||id(n,!1,t),id(n,!0,t))});var e=t.nodeType===9?t:t.ownerDocument;e===null||e[vc]||(e[vc]=!0,id("selectionchange",!1,e))}}function Hy(t,e,n,i){switch(jy(e)){case 2:var s=QM;break;case 8:s=ZM;break;default:s=Yp}n=s.bind(null,e,n,t),s=void 0,!xd||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(s=!0),i?s!==void 0?t.addEventListener(e,n,{capture:!0,passive:s}):t.addEventListener(e,n,!0):s!==void 0?t.addEventListener(e,n,{passive:s}):t.addEventListener(e,n,!1)}function sd(t,e,n,i,s){var r=i;if((e&1)===0&&(e&2)===0&&i!==null)e:for(;;){if(i===null)return;var a=i.tag;if(a===3||a===4){var o=i.stateNode.containerInfo;if(o===s)break;if(a===4)for(a=i.return;a!==null;){var l=a.tag;if((l===3||l===4)&&a.stateNode.containerInfo===s)return;a=a.return}for(;o!==null;){if(a=sa(o),a===null)return;if(l=a.tag,l===5||l===6||l===26||l===27){i=r=a;continue e}o=o.parentNode}}i=i.return}k0(function(){var c=r,f=lp(n),p=[];e:{var h=ix.get(t);if(h!==void 0){var d=uu,y=t;switch(t){case"keypress":if(Mc(n)===0)break e;case"keydown":case"keyup":d=v1;break;case"focusin":y="focus",d=Oh;break;case"focusout":y="blur",d=Oh;break;case"beforeblur":case"afterblur":d=Oh;break;case"click":if(n.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":d=cv;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":d=r1;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":d=_1;break;case $0:case ex:case tx:d=l1;break;case nx:d=S1;break;case"scroll":case"scrollend":d=i1;break;case"wheel":d=E1;break;case"copy":case"cut":case"paste":d=u1;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":d=fv;break;case"toggle":case"beforetoggle":d=b1}var _=(e&4)!==0,m=!_&&(t==="scroll"||t==="scrollend"),u=_?h!==null?h+"Capture":null:h;_=[];for(var g=c,v;g!==null;){var x=g;if(v=x.stateNode,x=x.tag,x!==5&&x!==26&&x!==27||v===null||u===null||(x=Xo(g,u),x!=null&&_.push(jo(g,x,v))),m)break;g=g.return}0<_.length&&(h=new d(h,y,null,n,f),p.push({event:h,listeners:_}))}}if((e&7)===0){e:{if(h=t==="mouseover"||t==="pointerover",d=t==="mouseout"||t==="pointerout",h&&n!==vd&&(y=n.relatedTarget||n.fromElement)&&(sa(y)||y[Ia]))break e;if((d||h)&&(h=f.window===f?f:(h=f.ownerDocument)?h.defaultView||h.parentWindow:window,d?(y=n.relatedTarget||n.toElement,d=c,y=y?sa(y):null,y!==null&&(m=sl(y),_=y.tag,y!==m||_!==5&&_!==27&&_!==6)&&(y=null)):(d=null,y=c),d!==y)){if(_=cv,x="onMouseLeave",u="onMouseEnter",g="mouse",(t==="pointerout"||t==="pointerover")&&(_=fv,x="onPointerLeave",u="onPointerEnter",g="pointer"),m=d==null?h:Co(d),v=y==null?h:Co(y),h=new _(x,g+"leave",d,n,f),h.target=m,h.relatedTarget=v,x=null,sa(f)===c&&(_=new _(u,g+"enter",y,n,f),_.target=v,_.relatedTarget=m,x=_),m=x,d&&y)t:{for(_=d,u=y,g=0,v=_;v;v=jr(v))g++;for(v=0,x=u;x;x=jr(x))v++;for(;0<g-v;)_=jr(_),g--;for(;0<v-g;)u=jr(u),v--;for(;g--;){if(_===u||u!==null&&_===u.alternate)break t;_=jr(_),u=jr(u)}_=null}else _=null;d!==null&&s0(p,h,d,_,!1),y!==null&&m!==null&&s0(p,m,y,_,!0)}}e:{if(h=c?Co(c):window,d=h.nodeName&&h.nodeName.toLowerCase(),d==="select"||d==="input"&&h.type==="file")var T=mv;else if(pv(h))if(Q0)T=N1;else{T=P1;var C=I1}else d=h.nodeName,!d||d.toLowerCase()!=="input"||h.type!=="checkbox"&&h.type!=="radio"?c&&op(c.elementType)&&(T=mv):T=L1;if(T&&(T=T(t,c))){q0(p,T,n,f);break e}C&&C(t,h,c),t==="focusout"&&c&&h.type==="number"&&c.memoizedProps.value!=null&&gd(h,"number",h.value)}switch(C=c?Co(c):window,t){case"focusin":(pv(C)||C.contentEditable==="true")&&(oa=C,yd=c,Bo=null);break;case"focusout":Bo=yd=oa=null;break;case"mousedown":_d=!0;break;case"contextmenu":case"mouseup":case"dragend":_d=!1,yv(p,n,f);break;case"selectionchange":if(F1)break;case"keydown":case"keyup":yv(p,n,f)}var w;if(fp)e:{switch(t){case"compositionstart":var D="onCompositionStart";break e;case"compositionend":D="onCompositionEnd";break e;case"compositionupdate":D="onCompositionUpdate";break e}D=void 0}else aa?X0(t,n)&&(D="onCompositionEnd"):t==="keydown"&&n.keyCode===229&&(D="onCompositionStart");D&&(W0&&n.locale!=="ko"&&(aa||D!=="onCompositionStart"?D==="onCompositionEnd"&&aa&&(w=V0()):(Ss=f,cp="value"in Ss?Ss.value:Ss.textContent,aa=!0)),C=nu(c,D),0<C.length&&(D=new uv(D,t,null,n,f),p.push({event:D,listeners:C}),w?D.data=w:(w=Y0(n),w!==null&&(D.data=w)))),(w=C1?R1(t,n):D1(t,n))&&(D=nu(c,"onBeforeInput"),0<D.length&&(C=new uv("onBeforeInput","beforeinput",null,n,f),p.push({event:C,listeners:D}),C.data=w)),_M(p,t,c,n,f)}zy(p,e)})}function jo(t,e,n){return{instance:t,listener:e,currentTarget:n}}function nu(t,e){for(var n=e+"Capture",i=[];t!==null;){var s=t,r=s.stateNode;if(s=s.tag,s!==5&&s!==26&&s!==27||r===null||(s=Xo(t,n),s!=null&&i.unshift(jo(t,s,r)),s=Xo(t,e),s!=null&&i.push(jo(t,s,r))),t.tag===3)return i;t=t.return}return[]}function jr(t){if(t===null)return null;do t=t.return;while(t&&t.tag!==5&&t.tag!==27);return t||null}function s0(t,e,n,i,s){for(var r=e._reactName,a=[];n!==null&&n!==i;){var o=n,l=o.alternate,c=o.stateNode;if(o=o.tag,l!==null&&l===i)break;o!==5&&o!==26&&o!==27||c===null||(l=c,s?(c=Xo(n,r),c!=null&&a.unshift(jo(n,c,l))):s||(c=Xo(n,r),c!=null&&a.push(jo(n,c,l)))),n=n.return}a.length!==0&&t.push({event:e,listeners:a})}var SM=/\r\n?/g,MM=/\u0000|\uFFFD/g;function r0(t){return(typeof t=="string"?t:""+t).replace(SM,`
`).replace(MM,"")}function Gy(t,e){return e=r0(e),r0(t)===e}function Su(){}function ut(t,e,n,i,s,r){switch(n){case"children":typeof i=="string"?e==="body"||e==="textarea"&&i===""||Ea(t,i):(typeof i=="number"||typeof i=="bigint")&&e!=="body"&&Ea(t,""+i);break;case"className":ac(t,"class",i);break;case"tabIndex":ac(t,"tabindex",i);break;case"dir":case"role":case"viewBox":case"width":case"height":ac(t,n,i);break;case"style":G0(t,i,r);break;case"data":if(e!=="object"){ac(t,"data",i);break}case"src":case"href":if(i===""&&(e!=="a"||n!=="href")){t.removeAttribute(n);break}if(i==null||typeof i=="function"||typeof i=="symbol"||typeof i=="boolean"){t.removeAttribute(n);break}i=Ac(""+i),t.setAttribute(n,i);break;case"action":case"formAction":if(typeof i=="function"){t.setAttribute(n,"javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')");break}else typeof r=="function"&&(n==="formAction"?(e!=="input"&&ut(t,e,"name",s.name,s,null),ut(t,e,"formEncType",s.formEncType,s,null),ut(t,e,"formMethod",s.formMethod,s,null),ut(t,e,"formTarget",s.formTarget,s,null)):(ut(t,e,"encType",s.encType,s,null),ut(t,e,"method",s.method,s,null),ut(t,e,"target",s.target,s,null)));if(i==null||typeof i=="symbol"||typeof i=="boolean"){t.removeAttribute(n);break}i=Ac(""+i),t.setAttribute(n,i);break;case"onClick":i!=null&&(t.onclick=Su);break;case"onScroll":i!=null&&Ve("scroll",t);break;case"onScrollEnd":i!=null&&Ve("scrollend",t);break;case"dangerouslySetInnerHTML":if(i!=null){if(typeof i!="object"||!("__html"in i))throw Error(Q(61));if(n=i.__html,n!=null){if(s.children!=null)throw Error(Q(60));t.innerHTML=n}}break;case"multiple":t.multiple=i&&typeof i!="function"&&typeof i!="symbol";break;case"muted":t.muted=i&&typeof i!="function"&&typeof i!="symbol";break;case"suppressContentEditableWarning":case"suppressHydrationWarning":case"defaultValue":case"defaultChecked":case"innerHTML":case"ref":break;case"autoFocus":break;case"xlinkHref":if(i==null||typeof i=="function"||typeof i=="boolean"||typeof i=="symbol"){t.removeAttribute("xlink:href");break}n=Ac(""+i),t.setAttributeNS("http://www.w3.org/1999/xlink","xlink:href",n);break;case"contentEditable":case"spellCheck":case"draggable":case"value":case"autoReverse":case"externalResourcesRequired":case"focusable":case"preserveAlpha":i!=null&&typeof i!="function"&&typeof i!="symbol"?t.setAttribute(n,""+i):t.removeAttribute(n);break;case"inert":case"allowFullScreen":case"async":case"autoPlay":case"controls":case"default":case"defer":case"disabled":case"disablePictureInPicture":case"disableRemotePlayback":case"formNoValidate":case"hidden":case"loop":case"noModule":case"noValidate":case"open":case"playsInline":case"readOnly":case"required":case"reversed":case"scoped":case"seamless":case"itemScope":i&&typeof i!="function"&&typeof i!="symbol"?t.setAttribute(n,""):t.removeAttribute(n);break;case"capture":case"download":i===!0?t.setAttribute(n,""):i!==!1&&i!=null&&typeof i!="function"&&typeof i!="symbol"?t.setAttribute(n,i):t.removeAttribute(n);break;case"cols":case"rows":case"size":case"span":i!=null&&typeof i!="function"&&typeof i!="symbol"&&!isNaN(i)&&1<=i?t.setAttribute(n,i):t.removeAttribute(n);break;case"rowSpan":case"start":i==null||typeof i=="function"||typeof i=="symbol"||isNaN(i)?t.removeAttribute(n):t.setAttribute(n,i);break;case"popover":Ve("beforetoggle",t),Ve("toggle",t),_c(t,"popover",i);break;case"xlinkActuate":Hi(t,"http://www.w3.org/1999/xlink","xlink:actuate",i);break;case"xlinkArcrole":Hi(t,"http://www.w3.org/1999/xlink","xlink:arcrole",i);break;case"xlinkRole":Hi(t,"http://www.w3.org/1999/xlink","xlink:role",i);break;case"xlinkShow":Hi(t,"http://www.w3.org/1999/xlink","xlink:show",i);break;case"xlinkTitle":Hi(t,"http://www.w3.org/1999/xlink","xlink:title",i);break;case"xlinkType":Hi(t,"http://www.w3.org/1999/xlink","xlink:type",i);break;case"xmlBase":Hi(t,"http://www.w3.org/XML/1998/namespace","xml:base",i);break;case"xmlLang":Hi(t,"http://www.w3.org/XML/1998/namespace","xml:lang",i);break;case"xmlSpace":Hi(t,"http://www.w3.org/XML/1998/namespace","xml:space",i);break;case"is":_c(t,"is",i);break;case"innerText":case"textContent":break;default:(!(2<n.length)||n[0]!=="o"&&n[0]!=="O"||n[1]!=="n"&&n[1]!=="N")&&(n=t1.get(n)||n,_c(t,n,i))}}function Xd(t,e,n,i,s,r){switch(n){case"style":G0(t,i,r);break;case"dangerouslySetInnerHTML":if(i!=null){if(typeof i!="object"||!("__html"in i))throw Error(Q(61));if(n=i.__html,n!=null){if(s.children!=null)throw Error(Q(60));t.innerHTML=n}}break;case"children":typeof i=="string"?Ea(t,i):(typeof i=="number"||typeof i=="bigint")&&Ea(t,""+i);break;case"onScroll":i!=null&&Ve("scroll",t);break;case"onScrollEnd":i!=null&&Ve("scrollend",t);break;case"onClick":i!=null&&(t.onclick=Su);break;case"suppressContentEditableWarning":case"suppressHydrationWarning":case"innerHTML":case"ref":break;case"innerText":case"textContent":break;default:if(!L0.hasOwnProperty(n))e:{if(n[0]==="o"&&n[1]==="n"&&(s=n.endsWith("Capture"),e=n.slice(2,s?n.length-7:void 0),r=t[wn]||null,r=r!=null?r[n]:null,typeof r=="function"&&t.removeEventListener(e,r,s),typeof i=="function")){typeof r!="function"&&r!==null&&(n in t?t[n]=null:t.hasAttribute(n)&&t.removeAttribute(n)),t.addEventListener(e,i,s);break e}n in t?t[n]=i:i===!0?t.setAttribute(n,""):_c(t,n,i)}}}function on(t,e,n){switch(e){case"div":case"span":case"svg":case"path":case"a":case"g":case"p":case"li":break;case"img":Ve("error",t),Ve("load",t);var i=!1,s=!1,r;for(r in n)if(n.hasOwnProperty(r)){var a=n[r];if(a!=null)switch(r){case"src":i=!0;break;case"srcSet":s=!0;break;case"children":case"dangerouslySetInnerHTML":throw Error(Q(137,e));default:ut(t,e,r,a,n,null)}}s&&ut(t,e,"srcSet",n.srcSet,n,null),i&&ut(t,e,"src",n.src,n,null);return;case"input":Ve("invalid",t);var o=r=a=s=null,l=null,c=null;for(i in n)if(n.hasOwnProperty(i)){var f=n[i];if(f!=null)switch(i){case"name":s=f;break;case"type":a=f;break;case"checked":l=f;break;case"defaultChecked":c=f;break;case"value":r=f;break;case"defaultValue":o=f;break;case"children":case"dangerouslySetInnerHTML":if(f!=null)throw Error(Q(137,e));break;default:ut(t,e,i,f,n,null)}}F0(t,r,o,l,c,a,s,!1),Oc(t);return;case"select":Ve("invalid",t),i=a=r=null;for(s in n)if(n.hasOwnProperty(s)&&(o=n[s],o!=null))switch(s){case"value":r=o;break;case"defaultValue":a=o;break;case"multiple":i=o;default:ut(t,e,s,o,n,null)}e=r,n=a,t.multiple=!!i,e!=null?ma(t,!!i,e,!1):n!=null&&ma(t,!!i,n,!0);return;case"textarea":Ve("invalid",t),r=s=i=null;for(a in n)if(n.hasOwnProperty(a)&&(o=n[a],o!=null))switch(a){case"value":i=o;break;case"defaultValue":s=o;break;case"children":r=o;break;case"dangerouslySetInnerHTML":if(o!=null)throw Error(Q(91));break;default:ut(t,e,a,o,n,null)}H0(t,i,s,r),Oc(t);return;case"option":for(l in n)if(n.hasOwnProperty(l)&&(i=n[l],i!=null))switch(l){case"selected":t.selected=i&&typeof i!="function"&&typeof i!="symbol";break;default:ut(t,e,l,i,n,null)}return;case"dialog":Ve("beforetoggle",t),Ve("toggle",t),Ve("cancel",t),Ve("close",t);break;case"iframe":case"object":Ve("load",t);break;case"video":case"audio":for(i=0;i<Jo.length;i++)Ve(Jo[i],t);break;case"image":Ve("error",t),Ve("load",t);break;case"details":Ve("toggle",t);break;case"embed":case"source":case"link":Ve("error",t),Ve("load",t);case"area":case"base":case"br":case"col":case"hr":case"keygen":case"meta":case"param":case"track":case"wbr":case"menuitem":for(c in n)if(n.hasOwnProperty(c)&&(i=n[c],i!=null))switch(c){case"children":case"dangerouslySetInnerHTML":throw Error(Q(137,e));default:ut(t,e,c,i,n,null)}return;default:if(op(e)){for(f in n)n.hasOwnProperty(f)&&(i=n[f],i!==void 0&&Xd(t,e,f,i,n,void 0));return}}for(o in n)n.hasOwnProperty(o)&&(i=n[o],i!=null&&ut(t,e,o,i,n,null))}function EM(t,e,n,i){switch(e){case"div":case"span":case"svg":case"path":case"a":case"g":case"p":case"li":break;case"input":var s=null,r=null,a=null,o=null,l=null,c=null,f=null;for(d in n){var p=n[d];if(n.hasOwnProperty(d)&&p!=null)switch(d){case"checked":break;case"value":break;case"defaultValue":l=p;default:i.hasOwnProperty(d)||ut(t,e,d,null,i,p)}}for(var h in i){var d=i[h];if(p=n[h],i.hasOwnProperty(h)&&(d!=null||p!=null))switch(h){case"type":r=d;break;case"name":s=d;break;case"checked":c=d;break;case"defaultChecked":f=d;break;case"value":a=d;break;case"defaultValue":o=d;break;case"children":case"dangerouslySetInnerHTML":if(d!=null)throw Error(Q(137,e));break;default:d!==p&&ut(t,e,h,d,i,p)}}md(t,a,o,l,c,f,r,s);return;case"select":d=a=o=h=null;for(r in n)if(l=n[r],n.hasOwnProperty(r)&&l!=null)switch(r){case"value":break;case"multiple":d=l;default:i.hasOwnProperty(r)||ut(t,e,r,null,i,l)}for(s in i)if(r=i[s],l=n[s],i.hasOwnProperty(s)&&(r!=null||l!=null))switch(s){case"value":h=r;break;case"defaultValue":o=r;break;case"multiple":a=r;default:r!==l&&ut(t,e,s,r,i,l)}e=o,n=a,i=d,h!=null?ma(t,!!n,h,!1):!!i!=!!n&&(e!=null?ma(t,!!n,e,!0):ma(t,!!n,n?[]:"",!1));return;case"textarea":d=h=null;for(o in n)if(s=n[o],n.hasOwnProperty(o)&&s!=null&&!i.hasOwnProperty(o))switch(o){case"value":break;case"children":break;default:ut(t,e,o,null,i,s)}for(a in i)if(s=i[a],r=n[a],i.hasOwnProperty(a)&&(s!=null||r!=null))switch(a){case"value":h=s;break;case"defaultValue":d=s;break;case"children":break;case"dangerouslySetInnerHTML":if(s!=null)throw Error(Q(91));break;default:s!==r&&ut(t,e,a,s,i,r)}z0(t,h,d);return;case"option":for(var y in n)if(h=n[y],n.hasOwnProperty(y)&&h!=null&&!i.hasOwnProperty(y))switch(y){case"selected":t.selected=!1;break;default:ut(t,e,y,null,i,h)}for(l in i)if(h=i[l],d=n[l],i.hasOwnProperty(l)&&h!==d&&(h!=null||d!=null))switch(l){case"selected":t.selected=h&&typeof h!="function"&&typeof h!="symbol";break;default:ut(t,e,l,h,i,d)}return;case"img":case"link":case"area":case"base":case"br":case"col":case"embed":case"hr":case"keygen":case"meta":case"param":case"source":case"track":case"wbr":case"menuitem":for(var _ in n)h=n[_],n.hasOwnProperty(_)&&h!=null&&!i.hasOwnProperty(_)&&ut(t,e,_,null,i,h);for(c in i)if(h=i[c],d=n[c],i.hasOwnProperty(c)&&h!==d&&(h!=null||d!=null))switch(c){case"children":case"dangerouslySetInnerHTML":if(h!=null)throw Error(Q(137,e));break;default:ut(t,e,c,h,i,d)}return;default:if(op(e)){for(var m in n)h=n[m],n.hasOwnProperty(m)&&h!==void 0&&!i.hasOwnProperty(m)&&Xd(t,e,m,void 0,i,h);for(f in i)h=i[f],d=n[f],!i.hasOwnProperty(f)||h===d||h===void 0&&d===void 0||Xd(t,e,f,h,i,d);return}}for(var u in n)h=n[u],n.hasOwnProperty(u)&&h!=null&&!i.hasOwnProperty(u)&&ut(t,e,u,null,i,h);for(p in i)h=i[p],d=n[p],!i.hasOwnProperty(p)||h===d||h==null&&d==null||ut(t,e,p,h,i,d)}var Yd=null,qd=null;function iu(t){return t.nodeType===9?t:t.ownerDocument}function a0(t){switch(t){case"http://www.w3.org/2000/svg":return 1;case"http://www.w3.org/1998/Math/MathML":return 2;default:return 0}}function ky(t,e){if(t===0)switch(e){case"svg":return 1;case"math":return 2;default:return 0}return t===1&&e==="foreignObject"?0:t}function Qd(t,e){return t==="textarea"||t==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.children=="bigint"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var rd=null;function TM(){var t=window.event;return t&&t.type==="popstate"?t===rd?!1:(rd=t,!0):(rd=null,!1)}var Vy=typeof setTimeout=="function"?setTimeout:void 0,bM=typeof clearTimeout=="function"?clearTimeout:void 0,o0=typeof Promise=="function"?Promise:void 0,wM=typeof queueMicrotask=="function"?queueMicrotask:typeof o0<"u"?function(t){return o0.resolve(null).then(t).catch(CM)}:Vy;function CM(t){setTimeout(function(){throw t})}function Os(t){return t==="head"}function l0(t,e){var n=e,i=0,s=0;do{var r=n.nextSibling;if(t.removeChild(n),r&&r.nodeType===8)if(n=r.data,n==="/$"){if(0<i&&8>i){n=i;var a=t.ownerDocument;if(n&1&&Vo(a.documentElement),n&2&&Vo(a.body),n&4)for(n=a.head,Vo(n),a=n.firstChild;a;){var o=a.nextSibling,l=a.nodeName;a[ll]||l==="SCRIPT"||l==="STYLE"||l==="LINK"&&a.rel.toLowerCase()==="stylesheet"||n.removeChild(a),a=o}}if(s===0){t.removeChild(r),il(e);return}s--}else n==="$"||n==="$?"||n==="$!"?s++:i=n.charCodeAt(0)-48;else i=0;n=r}while(n);il(e)}function Zd(t){var e=t.firstChild;for(e&&e.nodeType===10&&(e=e.nextSibling);e;){var n=e;switch(e=e.nextSibling,n.nodeName){case"HTML":case"HEAD":case"BODY":Zd(n),ap(n);continue;case"SCRIPT":case"STYLE":continue;case"LINK":if(n.rel.toLowerCase()==="stylesheet")continue}t.removeChild(n)}}function RM(t,e,n,i){for(;t.nodeType===1;){var s=n;if(t.nodeName.toLowerCase()!==e.toLowerCase()){if(!i&&(t.nodeName!=="INPUT"||t.type!=="hidden"))break}else if(i){if(!t[ll])switch(e){case"meta":if(!t.hasAttribute("itemprop"))break;return t;case"link":if(r=t.getAttribute("rel"),r==="stylesheet"&&t.hasAttribute("data-precedence"))break;if(r!==s.rel||t.getAttribute("href")!==(s.href==null||s.href===""?null:s.href)||t.getAttribute("crossorigin")!==(s.crossOrigin==null?null:s.crossOrigin)||t.getAttribute("title")!==(s.title==null?null:s.title))break;return t;case"style":if(t.hasAttribute("data-precedence"))break;return t;case"script":if(r=t.getAttribute("src"),(r!==(s.src==null?null:s.src)||t.getAttribute("type")!==(s.type==null?null:s.type)||t.getAttribute("crossorigin")!==(s.crossOrigin==null?null:s.crossOrigin))&&r&&t.hasAttribute("async")&&!t.hasAttribute("itemprop"))break;return t;default:return t}}else if(e==="input"&&t.type==="hidden"){var r=s.name==null?null:""+s.name;if(s.type==="hidden"&&t.getAttribute("name")===r)return t}else return t;if(t=fi(t.nextSibling),t===null)break}return null}function DM(t,e,n){if(e==="")return null;for(;t.nodeType!==3;)if((t.nodeType!==1||t.nodeName!=="INPUT"||t.type!=="hidden")&&!n||(t=fi(t.nextSibling),t===null))return null;return t}function Kd(t){return t.data==="$!"||t.data==="$?"&&t.ownerDocument.readyState==="complete"}function UM(t,e){var n=t.ownerDocument;if(t.data!=="$?"||n.readyState==="complete")e();else{var i=function(){e(),n.removeEventListener("DOMContentLoaded",i)};n.addEventListener("DOMContentLoaded",i),t._reactRetry=i}}function fi(t){for(;t!=null;t=t.nextSibling){var e=t.nodeType;if(e===1||e===3)break;if(e===8){if(e=t.data,e==="$"||e==="$!"||e==="$?"||e==="F!"||e==="F")break;if(e==="/$")return null}}return t}var Jd=null;function c0(t){t=t.previousSibling;for(var e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="$"||n==="$!"||n==="$?"){if(e===0)return t;e--}else n==="/$"&&e++}t=t.previousSibling}return null}function Wy(t,e,n){switch(e=iu(n),t){case"html":if(t=e.documentElement,!t)throw Error(Q(452));return t;case"head":if(t=e.head,!t)throw Error(Q(453));return t;case"body":if(t=e.body,!t)throw Error(Q(454));return t;default:throw Error(Q(451))}}function Vo(t){for(var e=t.attributes;e.length;)t.removeAttributeNode(e[0]);ap(t)}var si=new Map,u0=new Set;function su(t){return typeof t.getRootNode=="function"?t.getRootNode():t.nodeType===9?t:t.ownerDocument}var ts=it.d;it.d={f:BM,r:IM,D:PM,C:LM,L:NM,m:OM,X:zM,S:FM,M:HM};function BM(){var t=ts.f(),e=yu();return t||e}function IM(t){var e=Pa(t);e!==null&&e.tag===5&&e.type==="form"?Ox(e):ts.r(t)}var Oa=typeof document>"u"?null:document;function Xy(t,e,n){var i=Oa;if(i&&typeof e=="string"&&e){var s=ei(e);s='link[rel="'+t+'"][href="'+s+'"]',typeof n=="string"&&(s+='[crossorigin="'+n+'"]'),u0.has(s)||(u0.add(s),t={rel:t,crossOrigin:n,href:e},i.querySelector(s)===null&&(e=i.createElement("link"),on(e,"link",t),$t(e),i.head.appendChild(e)))}}function PM(t){ts.D(t),Xy("dns-prefetch",t,null)}function LM(t,e){ts.C(t,e),Xy("preconnect",t,e)}function NM(t,e,n){ts.L(t,e,n);var i=Oa;if(i&&t&&e){var s='link[rel="preload"][as="'+ei(e)+'"]';e==="image"&&n&&n.imageSrcSet?(s+='[imagesrcset="'+ei(n.imageSrcSet)+'"]',typeof n.imageSizes=="string"&&(s+='[imagesizes="'+ei(n.imageSizes)+'"]')):s+='[href="'+ei(t)+'"]';var r=s;switch(e){case"style":r=Ba(t);break;case"script":r=Fa(t)}si.has(r)||(t=yt({rel:"preload",href:e==="image"&&n&&n.imageSrcSet?void 0:t,as:e},n),si.set(r,t),i.querySelector(s)!==null||e==="style"&&i.querySelector(xl(r))||e==="script"&&i.querySelector(yl(r))||(e=i.createElement("link"),on(e,"link",t),$t(e),i.head.appendChild(e)))}}function OM(t,e){ts.m(t,e);var n=Oa;if(n&&t){var i=e&&typeof e.as=="string"?e.as:"script",s='link[rel="modulepreload"][as="'+ei(i)+'"][href="'+ei(t)+'"]',r=s;switch(i){case"audioworklet":case"paintworklet":case"serviceworker":case"sharedworker":case"worker":case"script":r=Fa(t)}if(!si.has(r)&&(t=yt({rel:"modulepreload",href:t},e),si.set(r,t),n.querySelector(s)===null)){switch(i){case"audioworklet":case"paintworklet":case"serviceworker":case"sharedworker":case"worker":case"script":if(n.querySelector(yl(r)))return}i=n.createElement("link"),on(i,"link",t),$t(i),n.head.appendChild(i)}}}function FM(t,e,n){ts.S(t,e,n);var i=Oa;if(i&&t){var s=pa(i).hoistableStyles,r=Ba(t);e=e||"default";var a=s.get(r);if(!a){var o={loading:0,preload:null};if(a=i.querySelector(xl(r)))o.loading=5;else{t=yt({rel:"stylesheet",href:t,"data-precedence":e},n),(n=si.get(r))&&Vp(t,n);var l=a=i.createElement("link");$t(l),on(l,"link",t),l._p=new Promise(function(c,f){l.onload=c,l.onerror=f}),l.addEventListener("load",function(){o.loading|=1}),l.addEventListener("error",function(){o.loading|=2}),o.loading|=4,Dc(a,e,i)}a={type:"stylesheet",instance:a,count:1,state:o},s.set(r,a)}}}function zM(t,e){ts.X(t,e);var n=Oa;if(n&&t){var i=pa(n).hoistableScripts,s=Fa(t),r=i.get(s);r||(r=n.querySelector(yl(s)),r||(t=yt({src:t,async:!0},e),(e=si.get(s))&&Wp(t,e),r=n.createElement("script"),$t(r),on(r,"link",t),n.head.appendChild(r)),r={type:"script",instance:r,count:1,state:null},i.set(s,r))}}function HM(t,e){ts.M(t,e);var n=Oa;if(n&&t){var i=pa(n).hoistableScripts,s=Fa(t),r=i.get(s);r||(r=n.querySelector(yl(s)),r||(t=yt({src:t,async:!0,type:"module"},e),(e=si.get(s))&&Wp(t,e),r=n.createElement("script"),$t(r),on(r,"link",t),n.head.appendChild(r)),r={type:"script",instance:r,count:1,state:null},i.set(s,r))}}function f0(t,e,n,i){var s=(s=Ts.current)?su(s):null;if(!s)throw Error(Q(446));switch(t){case"meta":case"title":return null;case"style":return typeof n.precedence=="string"&&typeof n.href=="string"?(e=Ba(n.href),n=pa(s).hoistableStyles,i=n.get(e),i||(i={type:"style",instance:null,count:0,state:null},n.set(e,i)),i):{type:"void",instance:null,count:0,state:null};case"link":if(n.rel==="stylesheet"&&typeof n.href=="string"&&typeof n.precedence=="string"){t=Ba(n.href);var r=pa(s).hoistableStyles,a=r.get(t);if(a||(s=s.ownerDocument||s,a={type:"stylesheet",instance:null,count:0,state:{loading:0,preload:null}},r.set(t,a),(r=s.querySelector(xl(t)))&&!r._p&&(a.instance=r,a.state.loading=5),si.has(t)||(n={rel:"preload",as:"style",href:n.href,crossOrigin:n.crossOrigin,integrity:n.integrity,media:n.media,hrefLang:n.hrefLang,referrerPolicy:n.referrerPolicy},si.set(t,n),r||GM(s,t,n,a.state))),e&&i===null)throw Error(Q(528,""));return a}if(e&&i!==null)throw Error(Q(529,""));return null;case"script":return e=n.async,n=n.src,typeof n=="string"&&e&&typeof e!="function"&&typeof e!="symbol"?(e=Fa(n),n=pa(s).hoistableScripts,i=n.get(e),i||(i={type:"script",instance:null,count:0,state:null},n.set(e,i)),i):{type:"void",instance:null,count:0,state:null};default:throw Error(Q(444,t))}}function Ba(t){return'href="'+ei(t)+'"'}function xl(t){return'link[rel="stylesheet"]['+t+"]"}function Yy(t){return yt({},t,{"data-precedence":t.precedence,precedence:null})}function GM(t,e,n,i){t.querySelector('link[rel="preload"][as="style"]['+e+"]")?i.loading=1:(e=t.createElement("link"),i.preload=e,e.addEventListener("load",function(){return i.loading|=1}),e.addEventListener("error",function(){return i.loading|=2}),on(e,"link",n),$t(e),t.head.appendChild(e))}function Fa(t){return'[src="'+ei(t)+'"]'}function yl(t){return"script[async]"+t}function h0(t,e,n){if(e.count++,e.instance===null)switch(e.type){case"style":var i=t.querySelector('style[data-href~="'+ei(n.href)+'"]');if(i)return e.instance=i,$t(i),i;var s=yt({},n,{"data-href":n.href,"data-precedence":n.precedence,href:null,precedence:null});return i=(t.ownerDocument||t).createElement("style"),$t(i),on(i,"style",s),Dc(i,n.precedence,t),e.instance=i;case"stylesheet":s=Ba(n.href);var r=t.querySelector(xl(s));if(r)return e.state.loading|=4,e.instance=r,$t(r),r;i=Yy(n),(s=si.get(s))&&Vp(i,s),r=(t.ownerDocument||t).createElement("link"),$t(r);var a=r;return a._p=new Promise(function(o,l){a.onload=o,a.onerror=l}),on(r,"link",i),e.state.loading|=4,Dc(r,n.precedence,t),e.instance=r;case"script":return r=Fa(n.src),(s=t.querySelector(yl(r)))?(e.instance=s,$t(s),s):(i=n,(s=si.get(r))&&(i=yt({},n),Wp(i,s)),t=t.ownerDocument||t,s=t.createElement("script"),$t(s),on(s,"link",i),t.head.appendChild(s),e.instance=s);case"void":return null;default:throw Error(Q(443,e.type))}else e.type==="stylesheet"&&(e.state.loading&4)===0&&(i=e.instance,e.state.loading|=4,Dc(i,n.precedence,t));return e.instance}function Dc(t,e,n){for(var i=n.querySelectorAll('link[rel="stylesheet"][data-precedence],style[data-precedence]'),s=i.length?i[i.length-1]:null,r=s,a=0;a<i.length;a++){var o=i[a];if(o.dataset.precedence===e)r=o;else if(r!==s)break}r?r.parentNode.insertBefore(t,r.nextSibling):(e=n.nodeType===9?n.head:n,e.insertBefore(t,e.firstChild))}function Vp(t,e){t.crossOrigin==null&&(t.crossOrigin=e.crossOrigin),t.referrerPolicy==null&&(t.referrerPolicy=e.referrerPolicy),t.title==null&&(t.title=e.title)}function Wp(t,e){t.crossOrigin==null&&(t.crossOrigin=e.crossOrigin),t.referrerPolicy==null&&(t.referrerPolicy=e.referrerPolicy),t.integrity==null&&(t.integrity=e.integrity)}var Uc=null;function d0(t,e,n){if(Uc===null){var i=new Map,s=Uc=new Map;s.set(n,i)}else s=Uc,i=s.get(n),i||(i=new Map,s.set(n,i));if(i.has(t))return i;for(i.set(t,null),n=n.getElementsByTagName(t),s=0;s<n.length;s++){var r=n[s];if(!(r[ll]||r[cn]||t==="link"&&r.getAttribute("rel")==="stylesheet")&&r.namespaceURI!=="http://www.w3.org/2000/svg"){var a=r.getAttribute(e)||"";a=t+a;var o=i.get(a);o?o.push(r):i.set(a,[r])}}return i}function p0(t,e,n){t=t.ownerDocument||t,t.head.insertBefore(n,e==="title"?t.querySelector("head > title"):null)}function kM(t,e,n){if(n===1||e.itemProp!=null)return!1;switch(t){case"meta":case"title":return!0;case"style":if(typeof e.precedence!="string"||typeof e.href!="string"||e.href==="")break;return!0;case"link":if(typeof e.rel!="string"||typeof e.href!="string"||e.href===""||e.onLoad||e.onError)break;switch(e.rel){case"stylesheet":return t=e.disabled,typeof e.precedence=="string"&&t==null;default:return!0}case"script":if(e.async&&typeof e.async!="function"&&typeof e.async!="symbol"&&!e.onLoad&&!e.onError&&e.src&&typeof e.src=="string")return!0}return!1}function qy(t){return!(t.type==="stylesheet"&&(t.state.loading&3)===0)}var $o=null;function VM(){}function WM(t,e,n){if($o===null)throw Error(Q(475));var i=$o;if(e.type==="stylesheet"&&(typeof n.media!="string"||matchMedia(n.media).matches!==!1)&&(e.state.loading&4)===0){if(e.instance===null){var s=Ba(n.href),r=t.querySelector(xl(s));if(r){t=r._p,t!==null&&typeof t=="object"&&typeof t.then=="function"&&(i.count++,i=ru.bind(i),t.then(i,i)),e.state.loading|=4,e.instance=r,$t(r);return}r=t.ownerDocument||t,n=Yy(n),(s=si.get(s))&&Vp(n,s),r=r.createElement("link"),$t(r);var a=r;a._p=new Promise(function(o,l){a.onload=o,a.onerror=l}),on(r,"link",n),e.instance=r}i.stylesheets===null&&(i.stylesheets=new Map),i.stylesheets.set(e,t),(t=e.state.preload)&&(e.state.loading&3)===0&&(i.count++,e=ru.bind(i),t.addEventListener("load",e),t.addEventListener("error",e))}}function XM(){if($o===null)throw Error(Q(475));var t=$o;return t.stylesheets&&t.count===0&&jd(t,t.stylesheets),0<t.count?function(e){var n=setTimeout(function(){if(t.stylesheets&&jd(t,t.stylesheets),t.unsuspend){var i=t.unsuspend;t.unsuspend=null,i()}},6e4);return t.unsuspend=e,function(){t.unsuspend=null,clearTimeout(n)}}:null}function ru(){if(this.count--,this.count===0){if(this.stylesheets)jd(this,this.stylesheets);else if(this.unsuspend){var t=this.unsuspend;this.unsuspend=null,t()}}}var au=null;function jd(t,e){t.stylesheets=null,t.unsuspend!==null&&(t.count++,au=new Map,e.forEach(YM,t),au=null,ru.call(t))}function YM(t,e){if(!(e.state.loading&4)){var n=au.get(t);if(n)var i=n.get(null);else{n=new Map,au.set(t,n);for(var s=t.querySelectorAll("link[data-precedence],style[data-precedence]"),r=0;r<s.length;r++){var a=s[r];(a.nodeName==="LINK"||a.getAttribute("media")!=="not all")&&(n.set(a.dataset.precedence,a),i=a)}i&&n.set(null,i)}s=e.instance,a=s.getAttribute("data-precedence"),r=n.get(a)||i,r===i&&n.set(null,s),n.set(a,s),this.count++,i=ru.bind(this),s.addEventListener("load",i),s.addEventListener("error",i),r?r.parentNode.insertBefore(s,r.nextSibling):(t=t.nodeType===9?t.head:t,t.insertBefore(s,t.firstChild)),e.state.loading|=4}}var el={$$typeof:Wi,Provider:null,Consumer:null,_currentValue:fr,_currentValue2:fr,_threadCount:0};function qM(t,e,n,i,s,r,a,o){this.tag=1,this.containerInfo=t,this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.next=this.pendingContext=this.context=this.cancelPendingCommit=null,this.callbackPriority=0,this.expirationTimes=Dh(-1),this.entangledLanes=this.shellSuspendCounter=this.errorRecoveryDisabledLanes=this.expiredLanes=this.warmLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=Dh(0),this.hiddenUpdates=Dh(null),this.identifierPrefix=i,this.onUncaughtError=s,this.onCaughtError=r,this.onRecoverableError=a,this.pooledCache=null,this.pooledCacheLanes=0,this.formState=o,this.incompleteTransitions=new Map}function Qy(t,e,n,i,s,r,a,o,l,c,f,p){return t=new qM(t,e,n,a,o,l,c,p),e=1,r===!0&&(e|=24),r=Ln(3,null,null,e),t.current=r,r.stateNode=t,e=xp(),e.refCount++,t.pooledCache=e,e.refCount++,r.memoizedState={element:i,isDehydrated:n,cache:e},_p(r),t}function Zy(t){return t?(t=ua,t):ua}function Ky(t,e,n,i,s,r){s=Zy(s),i.context===null?i.context=s:i.pendingContext=s,i=bs(e),i.payload={element:n},r=r===void 0?null:r,r!==null&&(i.callback=r),n=ws(t,i,e),n!==null&&(zn(n,t,e),Lo(n,t,e))}function m0(t,e){if(t=t.memoizedState,t!==null&&t.dehydrated!==null){var n=t.retryLane;t.retryLane=n!==0&&n<e?n:e}}function Xp(t,e){m0(t,e),(t=t.alternate)&&m0(t,e)}function Jy(t){if(t.tag===13){var e=La(t,67108864);e!==null&&zn(e,t,67108864),Xp(t,67108864)}}var ou=!0;function QM(t,e,n,i){var s=De.T;De.T=null;var r=it.p;try{it.p=2,Yp(t,e,n,i)}finally{it.p=r,De.T=s}}function ZM(t,e,n,i){var s=De.T;De.T=null;var r=it.p;try{it.p=8,Yp(t,e,n,i)}finally{it.p=r,De.T=s}}function Yp(t,e,n,i){if(ou){var s=$d(i);if(s===null)sd(t,e,i,lu,n),g0(t,i);else if(JM(s,t,e,n,i))i.stopPropagation();else if(g0(t,i),e&4&&-1<KM.indexOf(t)){for(;s!==null;){var r=Pa(s);if(r!==null)switch(r.tag){case 3:if(r=r.stateNode,r.current.memoizedState.isDehydrated){var a=lr(r.pendingLanes);if(a!==0){var o=r;for(o.pendingLanes|=2,o.entangledLanes|=2;a;){var l=1<<31-On(a);o.entanglements[1]|=l,a&=~l}Di(r),(ot&6)===0&&(jc=wi()+500,vl(0,!1))}}break;case 13:o=La(r,2),o!==null&&zn(o,r,2),yu(),Xp(r,2)}if(r=$d(i),r===null&&sd(t,e,i,lu,n),r===s)break;s=r}s!==null&&i.stopPropagation()}else sd(t,e,i,null,n)}}function $d(t){return t=lp(t),qp(t)}var lu=null;function qp(t){if(lu=null,t=sa(t),t!==null){var e=sl(t);if(e===null)t=null;else{var n=e.tag;if(n===13){if(t=S0(e),t!==null)return t;t=null}else if(n===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;t=null}else e!==t&&(t=null)}}return lu=t,null}function jy(t){switch(t){case"beforetoggle":case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"toggle":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 2;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 8;case"message":switch(OS()){case b0:return 2;case w0:return 8;case Nc:case FS:return 32;case C0:return 268435456;default:return 32}default:return 32}}var ep=!1,Ds=null,Us=null,Bs=null,tl=new Map,nl=new Map,_s=[],KM="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(" ");function g0(t,e){switch(t){case"focusin":case"focusout":Ds=null;break;case"dragenter":case"dragleave":Us=null;break;case"mouseover":case"mouseout":Bs=null;break;case"pointerover":case"pointerout":tl.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":nl.delete(e.pointerId)}}function Eo(t,e,n,i,s,r){return t===null||t.nativeEvent!==r?(t={blockedOn:e,domEventName:n,eventSystemFlags:i,nativeEvent:r,targetContainers:[s]},e!==null&&(e=Pa(e),e!==null&&Jy(e)),t):(t.eventSystemFlags|=i,e=t.targetContainers,s!==null&&e.indexOf(s)===-1&&e.push(s),t)}function JM(t,e,n,i,s){switch(e){case"focusin":return Ds=Eo(Ds,t,e,n,i,s),!0;case"dragenter":return Us=Eo(Us,t,e,n,i,s),!0;case"mouseover":return Bs=Eo(Bs,t,e,n,i,s),!0;case"pointerover":var r=s.pointerId;return tl.set(r,Eo(tl.get(r)||null,t,e,n,i,s)),!0;case"gotpointercapture":return r=s.pointerId,nl.set(r,Eo(nl.get(r)||null,t,e,n,i,s)),!0}return!1}function $y(t){var e=sa(t.target);if(e!==null){var n=sl(e);if(n!==null){if(e=n.tag,e===13){if(e=S0(n),e!==null){t.blockedOn=e,YS(t.priority,function(){if(n.tag===13){var i=Fn();i=sp(i);var s=La(n,i);s!==null&&zn(s,n,i),Xp(n,i)}});return}}else if(e===3&&n.stateNode.current.memoizedState.isDehydrated){t.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}t.blockedOn=null}function Bc(t){if(t.blockedOn!==null)return!1;for(var e=t.targetContainers;0<e.length;){var n=$d(t.nativeEvent);if(n===null){n=t.nativeEvent;var i=new n.constructor(n.type,n);vd=i,n.target.dispatchEvent(i),vd=null}else return e=Pa(n),e!==null&&Jy(e),t.blockedOn=n,!1;e.shift()}return!0}function v0(t,e,n){Bc(t)&&n.delete(e)}function jM(){ep=!1,Ds!==null&&Bc(Ds)&&(Ds=null),Us!==null&&Bc(Us)&&(Us=null),Bs!==null&&Bc(Bs)&&(Bs=null),tl.forEach(v0),nl.forEach(v0)}function xc(t,e){t.blockedOn===e&&(t.blockedOn=null,ep||(ep=!0,Wt.unstable_scheduleCallback(Wt.unstable_NormalPriority,jM)))}var yc=null;function x0(t){yc!==t&&(yc=t,Wt.unstable_scheduleCallback(Wt.unstable_NormalPriority,function(){yc===t&&(yc=null);for(var e=0;e<t.length;e+=3){var n=t[e],i=t[e+1],s=t[e+2];if(typeof i!="function"){if(qp(i||n)===null)continue;break}var r=Pa(n);r!==null&&(t.splice(e,3),e-=3,Id(r,{pending:!0,data:s,method:n.method,action:i},i,s))}}))}function il(t){function e(l){return xc(l,t)}Ds!==null&&xc(Ds,t),Us!==null&&xc(Us,t),Bs!==null&&xc(Bs,t),tl.forEach(e),nl.forEach(e);for(var n=0;n<_s.length;n++){var i=_s[n];i.blockedOn===t&&(i.blockedOn=null)}for(;0<_s.length&&(n=_s[0],n.blockedOn===null);)$y(n),n.blockedOn===null&&_s.shift();if(n=(t.ownerDocument||t).$$reactFormReplay,n!=null)for(i=0;i<n.length;i+=3){var s=n[i],r=n[i+1],a=s[wn]||null;if(typeof r=="function")a||x0(n);else if(a){var o=null;if(r&&r.hasAttribute("formAction")){if(s=r,a=r[wn]||null)o=a.formAction;else if(qp(s)!==null)continue}else o=a.action;typeof o=="function"?n[i+1]=o:(n.splice(i,3),i-=3),x0(n)}}}function Qp(t){this._internalRoot=t}Mu.prototype.render=Qp.prototype.render=function(t){var e=this._internalRoot;if(e===null)throw Error(Q(409));var n=e.current,i=Fn();Ky(n,i,t,e,null,null)};Mu.prototype.unmount=Qp.prototype.unmount=function(){var t=this._internalRoot;if(t!==null){this._internalRoot=null;var e=t.containerInfo;Ky(t.current,2,null,t,null,null),yu(),e[Ia]=null}};function Mu(t){this._internalRoot=t}Mu.prototype.unstable_scheduleHydration=function(t){if(t){var e=I0();t={blockedOn:null,target:t,priority:e};for(var n=0;n<_s.length&&e!==0&&e<_s[n].priority;n++);_s.splice(n,0,t),n===0&&$y(t)}};var y0=_0.version;if(y0!=="19.1.1")throw Error(Q(527,y0,"19.1.1"));it.findDOMNode=function(t){var e=t._reactInternals;if(e===void 0)throw typeof t.render=="function"?Error(Q(188)):(t=Object.keys(t).join(","),Error(Q(268,t)));return t=DS(e),t=t!==null?M0(t):null,t=t===null?null:t.stateNode,t};var $M={bundleType:0,version:"19.1.1",rendererPackageName:"react-dom",currentDispatcherRef:De,reconcilerVersion:"19.1.1"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(To=__REACT_DEVTOOLS_GLOBAL_HOOK__,!To.isDisabled&&To.supportsFiber))try{rl=To.inject($M),Nn=To}catch{}var To;Eu.createRoot=function(t,e){if(!A0(t))throw Error(Q(299));var n=!1,i="",s=Qx,r=Zx,a=Kx,o=null;return e!=null&&(e.unstable_strictMode===!0&&(n=!0),e.identifierPrefix!==void 0&&(i=e.identifierPrefix),e.onUncaughtError!==void 0&&(s=e.onUncaughtError),e.onCaughtError!==void 0&&(r=e.onCaughtError),e.onRecoverableError!==void 0&&(a=e.onRecoverableError),e.unstable_transitionCallbacks!==void 0&&(o=e.unstable_transitionCallbacks)),e=Qy(t,1,!1,null,null,n,i,s,r,a,o,null),t[Ia]=e.current,kp(t),new Qp(e)};Eu.hydrateRoot=function(t,e,n){if(!A0(t))throw Error(Q(299));var i=!1,s="",r=Qx,a=Zx,o=Kx,l=null,c=null;return n!=null&&(n.unstable_strictMode===!0&&(i=!0),n.identifierPrefix!==void 0&&(s=n.identifierPrefix),n.onUncaughtError!==void 0&&(r=n.onUncaughtError),n.onCaughtError!==void 0&&(a=n.onCaughtError),n.onRecoverableError!==void 0&&(o=n.onRecoverableError),n.unstable_transitionCallbacks!==void 0&&(l=n.unstable_transitionCallbacks),n.formState!==void 0&&(c=n.formState)),e=Qy(t,1,!0,e,n??null,i,s,r,a,o,l,c),e.context=Zy(null),n=e.current,i=Fn(),i=sp(i),s=bs(i),s.callback=null,ws(n,s,i),n=i,e.current.lanes=n,ol(e,n),Di(e),t[Ia]=e.current,kp(t),new Mu(e)};Eu.version="19.1.1"});var i_=Ai((xR,n_)=>{"use strict";function t_(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(t_)}catch(t){console.error(t)}}t_(),n_.exports=e_()});var YA=Ai(fh=>{"use strict";var nR=Symbol.for("react.transitional.element"),iR=Symbol.for("react.fragment");function XA(t,e,n){var i=null;if(n!==void 0&&(i=""+n),e.key!==void 0&&(i=""+e.key),"key"in e){n={};for(var s in e)s!=="key"&&(n[s]=e[s])}else n=e;return e=n.ref,{$$typeof:nR,type:t,key:i,ref:e!==void 0?e:null,props:n}}fh.Fragment=iR;fh.jsx=XA;fh.jsxs=XA});var Zl=Ai((kI,qA)=>{"use strict";qA.exports=YA()});var hh=ar(ho()),JA=ar(i_());var A_=0,Em=1,S_=2;var Tm=1,M_=2,Li=3,vi=0,Gt=1,Sn=2,Xn=0,Br=1,bm=2,wm=3,Cm=4,E_=5,Ys=100,T_=101,b_=102,w_=103,C_=104,R_=200,D_=201,U_=202,B_=203,Wu=204,Xu=205,I_=206,P_=207,L_=208,N_=209,O_=210,F_=211,z_=212,H_=213,G_=214,mf=0,so=1,gf=2,Ir=3,vf=4,xf=5,yf=6,_f=7,Rm=0,k_=1,V_=2,us=0,W_=1,X_=2,Y_=3,q_=4,Q_=5,Z_=6,K_=7;var Dm=300,Nr=301,Or=302,Af=303,Sf=304,Hl=306,Yu=1e3,Xs=1001,qu=1002,ai=1003,J_=1004;var Gl=1005;var Ht=1006,Mf=1007;var js=1008;var sn=1009,Um=1010,Bm=1011,ro=1012,Ef=1013,$s=1014,li=1015,ao=1016,Tf=1017,bf=1018,er=1020,Im=35902,Pm=35899,Lm=1021,Nm=1022,ci=1023,ja=1026,tr=1027,Om=1028,wf=1029,Fm=1030,Cf=1031;var Rf=1033,kl=33776,Vl=33777,Wl=33778,Xl=33779,Df=35840,Uf=35841,Bf=35842,If=35843,Pf=36196,Lf=37492,Nf=37496,Of=37808,Ff=37809,zf=37810,Hf=37811,Gf=37812,kf=37813,Vf=37814,Wf=37815,Xf=37816,Yf=37817,qf=37818,Qf=37819,Zf=37820,Kf=37821,Jf=36492,jf=36494,$f=36495,eh=36283,th=36284,nh=36285,ih=36286;var Tl=2300,Qu=2301,Vu=2302,xm=2400,ym=2401,_m=2402;var Ni=3200,j_=3201;var $_=0,eA=1,Yn="",At="srgb",xi="srgb-linear",bl="linear",lt="srgb";var Dr=7680;var Am=519,tA=512,nA=513,iA=514,zm=515,sA=516,rA=517,aA=518,oA=519,Sm=35044;var Yl="300 es",gi=2e3,wl=2001;var Vn=class{addEventListener(e,n){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(n)===-1&&i[e].push(n)}hasEventListener(e,n){let i=this._listeners;return i===void 0?!1:i[e]!==void 0&&i[e].indexOf(n)!==-1}removeEventListener(e,n){let i=this._listeners;if(i===void 0)return;let s=i[e];if(s!==void 0){let r=s.indexOf(n);r!==-1&&s.splice(r,1)}}dispatchEvent(e){let n=this._listeners;if(n===void 0)return;let i=n[e.type];if(i!==void 0){e.target=this;let s=i.slice(0);for(let r=0,a=s.length;r<a;r++)s[r].call(this,e);e.target=null}}},fn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];var Zp=Math.PI/180,Zu=180/Math.PI;function ql(){let t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(fn[t&255]+fn[t>>8&255]+fn[t>>16&255]+fn[t>>24&255]+"-"+fn[e&255]+fn[e>>8&255]+"-"+fn[e>>16&15|64]+fn[e>>24&255]+"-"+fn[n&63|128]+fn[n>>8&255]+"-"+fn[n>>16&255]+fn[n>>24&255]+fn[i&255]+fn[i>>8&255]+fn[i>>16&255]+fn[i>>24&255]).toLowerCase()}function Ye(t,e,n){return Math.max(e,Math.min(n,t))}function eE(t,e){return(t%e+e)%e}function Kp(t,e,n){return(1-n)*t+n*e}function _l(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return t/4294967295;case Uint16Array:return t/65535;case Uint8Array:return t/255;case Int32Array:return Math.max(t/2147483647,-1);case Int16Array:return Math.max(t/32767,-1);case Int8Array:return Math.max(t/127,-1);default:throw new Error("Invalid component type.")}}function Rn(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return Math.round(t*4294967295);case Uint16Array:return Math.round(t*65535);case Uint8Array:return Math.round(t*255);case Int32Array:return Math.round(t*2147483647);case Int16Array:return Math.round(t*32767);case Int8Array:return Math.round(t*127);default:throw new Error("Invalid component type.")}}var Le=class t{constructor(e=0,n=0){t.prototype.isVector2=!0,this.x=e,this.y=n}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,n){return this.x=e,this.y=n,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let n=this.x,i=this.y,s=e.elements;return this.x=s[0]*n+s[3]*i+s[6],this.y=s[1]*n+s[4]*i+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,n){return this.x=Ye(this.x,e.x,n.x),this.y=Ye(this.y,e.y,n.y),this}clampScalar(e,n){return this.x=Ye(this.x,e,n),this.y=Ye(this.y,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ye(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(Ye(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y;return n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this}rotateAround(e,n){let i=Math.cos(n),s=Math.sin(n),r=this.x-e.x,a=this.y-e.y;return this.x=r*i-a*s+e.x,this.y=r*s+a*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},ls=class{constructor(e=0,n=0,i=0,s=1){this.isQuaternion=!0,this._x=e,this._y=n,this._z=i,this._w=s}static slerpFlat(e,n,i,s,r,a,o){let l=i[s+0],c=i[s+1],f=i[s+2],p=i[s+3],h=r[a+0],d=r[a+1],y=r[a+2],_=r[a+3];if(o===0){e[n+0]=l,e[n+1]=c,e[n+2]=f,e[n+3]=p;return}if(o===1){e[n+0]=h,e[n+1]=d,e[n+2]=y,e[n+3]=_;return}if(p!==_||l!==h||c!==d||f!==y){let m=1-o,u=l*h+c*d+f*y+p*_,g=u>=0?1:-1,v=1-u*u;if(v>Number.EPSILON){let T=Math.sqrt(v),C=Math.atan2(T,u*g);m=Math.sin(m*C)/T,o=Math.sin(o*C)/T}let x=o*g;if(l=l*m+h*x,c=c*m+d*x,f=f*m+y*x,p=p*m+_*x,m===1-o){let T=1/Math.sqrt(l*l+c*c+f*f+p*p);l*=T,c*=T,f*=T,p*=T}}e[n]=l,e[n+1]=c,e[n+2]=f,e[n+3]=p}static multiplyQuaternionsFlat(e,n,i,s,r,a){let o=i[s],l=i[s+1],c=i[s+2],f=i[s+3],p=r[a],h=r[a+1],d=r[a+2],y=r[a+3];return e[n]=o*y+f*p+l*d-c*h,e[n+1]=l*y+f*h+c*p-o*d,e[n+2]=c*y+f*d+o*h-l*p,e[n+3]=f*y-o*p-l*h-c*d,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,n,i,s){return this._x=e,this._y=n,this._z=i,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,n=!0){let i=e._x,s=e._y,r=e._z,a=e._order,o=Math.cos,l=Math.sin,c=o(i/2),f=o(s/2),p=o(r/2),h=l(i/2),d=l(s/2),y=l(r/2);switch(a){case"XYZ":this._x=h*f*p+c*d*y,this._y=c*d*p-h*f*y,this._z=c*f*y+h*d*p,this._w=c*f*p-h*d*y;break;case"YXZ":this._x=h*f*p+c*d*y,this._y=c*d*p-h*f*y,this._z=c*f*y-h*d*p,this._w=c*f*p+h*d*y;break;case"ZXY":this._x=h*f*p-c*d*y,this._y=c*d*p+h*f*y,this._z=c*f*y+h*d*p,this._w=c*f*p-h*d*y;break;case"ZYX":this._x=h*f*p-c*d*y,this._y=c*d*p+h*f*y,this._z=c*f*y-h*d*p,this._w=c*f*p+h*d*y;break;case"YZX":this._x=h*f*p+c*d*y,this._y=c*d*p+h*f*y,this._z=c*f*y-h*d*p,this._w=c*f*p-h*d*y;break;case"XZY":this._x=h*f*p-c*d*y,this._y=c*d*p-h*f*y,this._z=c*f*y+h*d*p,this._w=c*f*p+h*d*y;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+a)}return n===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,n){let i=n/2,s=Math.sin(i);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){let n=e.elements,i=n[0],s=n[4],r=n[8],a=n[1],o=n[5],l=n[9],c=n[2],f=n[6],p=n[10],h=i+o+p;if(h>0){let d=.5/Math.sqrt(h+1);this._w=.25/d,this._x=(f-l)*d,this._y=(r-c)*d,this._z=(a-s)*d}else if(i>o&&i>p){let d=2*Math.sqrt(1+i-o-p);this._w=(f-l)/d,this._x=.25*d,this._y=(s+a)/d,this._z=(r+c)/d}else if(o>p){let d=2*Math.sqrt(1+o-i-p);this._w=(r-c)/d,this._x=(s+a)/d,this._y=.25*d,this._z=(l+f)/d}else{let d=2*Math.sqrt(1+p-i-o);this._w=(a-s)/d,this._x=(r+c)/d,this._y=(l+f)/d,this._z=.25*d}return this._onChangeCallback(),this}setFromUnitVectors(e,n){let i=e.dot(n)+1;return i<1e-8?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*n.z-e.z*n.y,this._y=e.z*n.x-e.x*n.z,this._z=e.x*n.y-e.y*n.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ye(this.dot(e),-1,1)))}rotateTowards(e,n){let i=this.angleTo(e);if(i===0)return this;let s=Math.min(1,n/i);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,n){let i=e._x,s=e._y,r=e._z,a=e._w,o=n._x,l=n._y,c=n._z,f=n._w;return this._x=i*f+a*o+s*c-r*l,this._y=s*f+a*l+r*o-i*c,this._z=r*f+a*c+i*l-s*o,this._w=a*f-i*o-s*l-r*c,this._onChangeCallback(),this}slerp(e,n){if(n===0)return this;if(n===1)return this.copy(e);let i=this._x,s=this._y,r=this._z,a=this._w,o=a*e._w+i*e._x+s*e._y+r*e._z;if(o<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,o=-o):this.copy(e),o>=1)return this._w=a,this._x=i,this._y=s,this._z=r,this;let l=1-o*o;if(l<=Number.EPSILON){let d=1-n;return this._w=d*a+n*this._w,this._x=d*i+n*this._x,this._y=d*s+n*this._y,this._z=d*r+n*this._z,this.normalize(),this}let c=Math.sqrt(l),f=Math.atan2(c,o),p=Math.sin((1-n)*f)/c,h=Math.sin(n*f)/c;return this._w=a*p+this._w*h,this._x=i*p+this._x*h,this._y=s*p+this._y*h,this._z=r*p+this._z*h,this._onChangeCallback(),this}slerpQuaternions(e,n,i){return this.copy(e).slerp(n,i)}random(){let e=2*Math.PI*Math.random(),n=2*Math.PI*Math.random(),i=Math.random(),s=Math.sqrt(1-i),r=Math.sqrt(i);return this.set(s*Math.sin(e),s*Math.cos(e),r*Math.sin(n),r*Math.cos(n))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,n=0){return this._x=e[n],this._y=e[n+1],this._z=e[n+2],this._w=e[n+3],this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._w,e}fromBufferAttribute(e,n){return this._x=e.getX(n),this._y=e.getY(n),this._z=e.getZ(n),this._w=e.getW(n),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},z=class t{constructor(e=0,n=0,i=0){t.prototype.isVector3=!0,this.x=e,this.y=n,this.z=i}set(e,n,i){return i===void 0&&(i=this.z),this.x=e,this.y=n,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,n){return this.x=e.x*n.x,this.y=e.y*n.y,this.z=e.z*n.z,this}applyEuler(e){return this.applyQuaternion(s_.setFromEuler(e))}applyAxisAngle(e,n){return this.applyQuaternion(s_.setFromAxisAngle(e,n))}applyMatrix3(e){let n=this.x,i=this.y,s=this.z,r=e.elements;return this.x=r[0]*n+r[3]*i+r[6]*s,this.y=r[1]*n+r[4]*i+r[7]*s,this.z=r[2]*n+r[5]*i+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let n=this.x,i=this.y,s=this.z,r=e.elements,a=1/(r[3]*n+r[7]*i+r[11]*s+r[15]);return this.x=(r[0]*n+r[4]*i+r[8]*s+r[12])*a,this.y=(r[1]*n+r[5]*i+r[9]*s+r[13])*a,this.z=(r[2]*n+r[6]*i+r[10]*s+r[14])*a,this}applyQuaternion(e){let n=this.x,i=this.y,s=this.z,r=e.x,a=e.y,o=e.z,l=e.w,c=2*(a*s-o*i),f=2*(o*n-r*s),p=2*(r*i-a*n);return this.x=n+l*c+a*p-o*f,this.y=i+l*f+o*c-r*p,this.z=s+l*p+r*f-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let n=this.x,i=this.y,s=this.z,r=e.elements;return this.x=r[0]*n+r[4]*i+r[8]*s,this.y=r[1]*n+r[5]*i+r[9]*s,this.z=r[2]*n+r[6]*i+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,n){return this.x=Ye(this.x,e.x,n.x),this.y=Ye(this.y,e.y,n.y),this.z=Ye(this.z,e.z,n.z),this}clampScalar(e,n){return this.x=Ye(this.x,e,n),this.y=Ye(this.y,e,n),this.z=Ye(this.z,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ye(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,n){let i=e.x,s=e.y,r=e.z,a=n.x,o=n.y,l=n.z;return this.x=s*l-r*o,this.y=r*a-i*l,this.z=i*o-s*a,this}projectOnVector(e){let n=e.lengthSq();if(n===0)return this.set(0,0,0);let i=e.dot(this)/n;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return Jp.copy(this).projectOnVector(e),this.sub(Jp)}reflect(e){return this.sub(Jp.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(Ye(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y,s=this.z-e.z;return n*n+i*i+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,n,i){let s=Math.sin(n)*e;return this.x=s*Math.sin(i),this.y=Math.cos(n)*e,this.z=s*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,n,i){return this.x=e*Math.sin(n),this.y=i,this.z=e*Math.cos(n),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this}setFromMatrixScale(e){let n=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=n,this.y=i,this.z=s,this}setFromMatrixColumn(e,n){return this.fromArray(e.elements,n*4)}setFromMatrix3Column(e,n){return this.fromArray(e.elements,n*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,n=Math.random()*2-1,i=Math.sqrt(1-n*n);return this.x=i*Math.cos(e),this.y=n,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Jp=new z,s_=new ls,Ne=class t{constructor(e,n,i,s,r,a,o,l,c){t.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,n,i,s,r,a,o,l,c)}set(e,n,i,s,r,a,o,l,c){let f=this.elements;return f[0]=e,f[1]=s,f[2]=o,f[3]=n,f[4]=r,f[5]=l,f[6]=i,f[7]=a,f[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],this}extractBasis(e,n,i){return e.setFromMatrix3Column(this,0),n.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let n=e.elements;return this.set(n[0],n[4],n[8],n[1],n[5],n[9],n[2],n[6],n[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,s=n.elements,r=this.elements,a=i[0],o=i[3],l=i[6],c=i[1],f=i[4],p=i[7],h=i[2],d=i[5],y=i[8],_=s[0],m=s[3],u=s[6],g=s[1],v=s[4],x=s[7],T=s[2],C=s[5],w=s[8];return r[0]=a*_+o*g+l*T,r[3]=a*m+o*v+l*C,r[6]=a*u+o*x+l*w,r[1]=c*_+f*g+p*T,r[4]=c*m+f*v+p*C,r[7]=c*u+f*x+p*w,r[2]=h*_+d*g+y*T,r[5]=h*m+d*v+y*C,r[8]=h*u+d*x+y*w,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[3]*=e,n[6]*=e,n[1]*=e,n[4]*=e,n[7]*=e,n[2]*=e,n[5]*=e,n[8]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],f=e[8];return n*a*f-n*o*c-i*r*f+i*o*l+s*r*c-s*a*l}invert(){let e=this.elements,n=e[0],i=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],f=e[8],p=f*a-o*c,h=o*l-f*r,d=c*r-a*l,y=n*p+i*h+s*d;if(y===0)return this.set(0,0,0,0,0,0,0,0,0);let _=1/y;return e[0]=p*_,e[1]=(s*c-f*i)*_,e[2]=(o*i-s*a)*_,e[3]=h*_,e[4]=(f*n-s*l)*_,e[5]=(s*r-o*n)*_,e[6]=d*_,e[7]=(i*l-c*n)*_,e[8]=(a*n-i*r)*_,this}transpose(){let e,n=this.elements;return e=n[1],n[1]=n[3],n[3]=e,e=n[2],n[2]=n[6],n[6]=e,e=n[5],n[5]=n[7],n[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let n=this.elements;return e[0]=n[0],e[1]=n[3],e[2]=n[6],e[3]=n[1],e[4]=n[4],e[5]=n[7],e[6]=n[2],e[7]=n[5],e[8]=n[8],this}setUvTransform(e,n,i,s,r,a,o){let l=Math.cos(r),c=Math.sin(r);return this.set(i*l,i*c,-i*(l*a+c*o)+a+e,-s*c,s*l,-s*(-c*a+l*o)+o+n,0,0,1),this}scale(e,n){return this.premultiply(jp.makeScale(e,n)),this}rotate(e){return this.premultiply(jp.makeRotation(-e)),this}translate(e,n){return this.premultiply(jp.makeTranslation(e,n)),this}makeTranslation(e,n){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,n,0,0,1),this}makeRotation(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,i,n,0,0,0,1),this}makeScale(e,n){return this.set(e,0,0,0,n,0,0,0,1),this}equals(e){let n=this.elements,i=e.elements;for(let s=0;s<9;s++)if(n[s]!==i[s])return!1;return!0}fromArray(e,n=0){for(let i=0;i<9;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}},jp=new Ne;function Hm(t){for(let e=t.length-1;e>=0;--e)if(t[e]>=65535)return!0;return!1}function Cl(t){return document.createElementNS("http://www.w3.org/1999/xhtml",t)}function lA(){let t=Cl("canvas");return t.style.display="block",t}var r_={};function $a(t){t in r_||(r_[t]=!0,console.warn(t))}function cA(t,e,n){return new Promise(function(i,s){function r(){switch(t.clientWaitSync(e,t.SYNC_FLUSH_COMMANDS_BIT,0)){case t.WAIT_FAILED:s();break;case t.TIMEOUT_EXPIRED:setTimeout(r,n);break;default:i()}}setTimeout(r,n)})}var a_=new Ne().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),o_=new Ne().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function tE(){let t={enabled:!0,workingColorSpace:xi,spaces:{},convert:function(s,r,a){return this.enabled===!1||r===a||!r||!a||(this.spaces[r].transfer===lt&&(s.r=os(s.r),s.g=os(s.g),s.b=os(s.b)),this.spaces[r].primaries!==this.spaces[a].primaries&&(s.applyMatrix3(this.spaces[r].toXYZ),s.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===lt&&(s.r=Ja(s.r),s.g=Ja(s.g),s.b=Ja(s.b))),s},workingToColorSpace:function(s,r){return this.convert(s,this.workingColorSpace,r)},colorSpaceToWorking:function(s,r){return this.convert(s,r,this.workingColorSpace)},getPrimaries:function(s){return this.spaces[s].primaries},getTransfer:function(s){return s===Yn?bl:this.spaces[s].transfer},getToneMappingMode:function(s){return this.spaces[s].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(s,r=this.workingColorSpace){return s.fromArray(this.spaces[r].luminanceCoefficients)},define:function(s){Object.assign(this.spaces,s)},_getMatrix:function(s,r,a){return s.copy(this.spaces[r].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(s){return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(s=this.workingColorSpace){return this.spaces[s].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(s,r){return $a("THREE.ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),t.workingToColorSpace(s,r)},toWorkingColorSpace:function(s,r){return $a("THREE.ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),t.colorSpaceToWorking(s,r)}},e=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],i=[.3127,.329];return t.define({[xi]:{primaries:e,whitePoint:i,transfer:bl,toXYZ:a_,fromXYZ:o_,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:At},outputColorSpaceConfig:{drawingBufferColorSpace:At}},[At]:{primaries:e,whitePoint:i,transfer:lt,toXYZ:a_,fromXYZ:o_,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:At}}}),t}var je=tE();function os(t){return t<.04045?t*.0773993808:Math.pow(t*.9478672986+.0521327014,2.4)}function Ja(t){return t<.0031308?t*12.92:1.055*Math.pow(t,.41666)-.055}var za,Ku=class{static getDataURL(e,n="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let i;if(e instanceof HTMLCanvasElement)i=e;else{za===void 0&&(za=Cl("canvas")),za.width=e.width,za.height=e.height;let s=za.getContext("2d");e instanceof ImageData?s.putImageData(e,0,0):s.drawImage(e,0,0,e.width,e.height),i=za}return i.toDataURL(n)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let n=Cl("canvas");n.width=e.width,n.height=e.height;let i=n.getContext("2d");i.drawImage(e,0,0,e.width,e.height);let s=i.getImageData(0,0,e.width,e.height),r=s.data;for(let a=0;a<r.length;a++)r[a]=os(r[a]/255)*255;return i.putImageData(s,0,0),n}else if(e.data){let n=e.data.slice(0);for(let i=0;i<n.length;i++)n instanceof Uint8Array||n instanceof Uint8ClampedArray?n[i]=Math.floor(os(n[i]/255)*255):n[i]=os(n[i]);return{data:n,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},nE=0,eo=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:nE++}),this.uuid=ql(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let n=this.data;return typeof HTMLVideoElement<"u"&&n instanceof HTMLVideoElement?e.set(n.videoWidth,n.videoHeight,0):n instanceof VideoFrame?e.set(n.displayHeight,n.displayWidth,0):n!==null?e.set(n.width,n.height,n.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let i={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let a=0,o=s.length;a<o;a++)s[a].isDataTexture?r.push($p(s[a].image)):r.push($p(s[a]))}else r=$p(s);i.url=r}return n||(e.images[this.uuid]=i),i}};function $p(t){return typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap?Ku.getDataURL(t):t.data?{data:Array.from(t.data),width:t.width,height:t.height,type:t.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}var iE=0,em=new z,Yt=class t extends Vn{constructor(e=t.DEFAULT_IMAGE,n=t.DEFAULT_MAPPING,i=Xs,s=Xs,r=Ht,a=js,o=ci,l=sn,c=t.DEFAULT_ANISOTROPY,f=Yn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:iE++}),this.uuid=ql(),this.name="",this.source=new eo(e),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=i,this.wrapT=s,this.magFilter=r,this.minFilter=a,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new Le(0,0),this.repeat=new Le(1,1),this.center=new Le(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Ne,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=f,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0}get width(){return this.source.getSize(em).x}get height(){return this.source.getSize(em).y}get depth(){return this.source.getSize(em).z}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let n in e){let i=e[n];if(i===void 0){console.warn(`THREE.Texture.setValues(): parameter '${n}' has value of undefined.`);continue}let s=this[n];if(s===void 0){console.warn(`THREE.Texture.setValues(): property '${n}' does not exist.`);continue}s&&i&&s.isVector2&&i.isVector2||s&&i&&s.isVector3&&i.isVector3||s&&i&&s.isMatrix3&&i.isMatrix3?s.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),n||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==Dm)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Yu:e.x=e.x-Math.floor(e.x);break;case Xs:e.x=e.x<0?0:1;break;case qu:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Yu:e.y=e.y-Math.floor(e.y);break;case Xs:e.y=e.y<0?0:1;break;case qu:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Yt.DEFAULT_IMAGE=null;Yt.DEFAULT_MAPPING=Dm;Yt.DEFAULT_ANISOTROPY=1;var Bt=class t{constructor(e=0,n=0,i=0,s=1){t.prototype.isVector4=!0,this.x=e,this.y=n,this.z=i,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,n,i,s){return this.x=e,this.y=n,this.z=i,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;case 3:this.w=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this.w=e.w+n.w,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this.w+=e.w*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this.w=e.w-n.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let n=this.x,i=this.y,s=this.z,r=this.w,a=e.elements;return this.x=a[0]*n+a[4]*i+a[8]*s+a[12]*r,this.y=a[1]*n+a[5]*i+a[9]*s+a[13]*r,this.z=a[2]*n+a[6]*i+a[10]*s+a[14]*r,this.w=a[3]*n+a[7]*i+a[11]*s+a[15]*r,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let n=Math.sqrt(1-e.w*e.w);return n<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/n,this.y=e.y/n,this.z=e.z/n),this}setAxisAngleFromRotationMatrix(e){let n,i,s,r,l=e.elements,c=l[0],f=l[4],p=l[8],h=l[1],d=l[5],y=l[9],_=l[2],m=l[6],u=l[10];if(Math.abs(f-h)<.01&&Math.abs(p-_)<.01&&Math.abs(y-m)<.01){if(Math.abs(f+h)<.1&&Math.abs(p+_)<.1&&Math.abs(y+m)<.1&&Math.abs(c+d+u-3)<.1)return this.set(1,0,0,0),this;n=Math.PI;let v=(c+1)/2,x=(d+1)/2,T=(u+1)/2,C=(f+h)/4,w=(p+_)/4,D=(y+m)/4;return v>x&&v>T?v<.01?(i=0,s=.707106781,r=.707106781):(i=Math.sqrt(v),s=C/i,r=w/i):x>T?x<.01?(i=.707106781,s=0,r=.707106781):(s=Math.sqrt(x),i=C/s,r=D/s):T<.01?(i=.707106781,s=.707106781,r=0):(r=Math.sqrt(T),i=w/r,s=D/r),this.set(i,s,r,n),this}let g=Math.sqrt((m-y)*(m-y)+(p-_)*(p-_)+(h-f)*(h-f));return Math.abs(g)<.001&&(g=1),this.x=(m-y)/g,this.y=(p-_)/g,this.z=(h-f)/g,this.w=Math.acos((c+d+u-1)/2),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this.w=n[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,n){return this.x=Ye(this.x,e.x,n.x),this.y=Ye(this.y,e.y,n.y),this.z=Ye(this.z,e.z,n.z),this.w=Ye(this.w,e.w,n.w),this}clampScalar(e,n){return this.x=Ye(this.x,e,n),this.y=Ye(this.y,e,n),this.z=Ye(this.z,e,n),this.w=Ye(this.w,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ye(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this.w+=(e.w-this.w)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this.w=e.w+(n.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this.w=e[n+3],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e[n+3]=this.w,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this.w=e.getW(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Ju=class extends Vn{constructor(e=1,n=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Ht,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},i),this.isRenderTarget=!0,this.width=e,this.height=n,this.depth=i.depth,this.scissor=new Bt(0,0,e,n),this.scissorTest=!1,this.viewport=new Bt(0,0,e,n);let s={width:e,height:n,depth:i.depth},r=new Yt(s);this.textures=[];let a=i.count;for(let o=0;o<a;o++)this.textures[o]=r.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview}_setTextureOptions(e={}){let n={minFilter:Ht,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(n.mapping=e.mapping),e.wrapS!==void 0&&(n.wrapS=e.wrapS),e.wrapT!==void 0&&(n.wrapT=e.wrapT),e.wrapR!==void 0&&(n.wrapR=e.wrapR),e.magFilter!==void 0&&(n.magFilter=e.magFilter),e.minFilter!==void 0&&(n.minFilter=e.minFilter),e.format!==void 0&&(n.format=e.format),e.type!==void 0&&(n.type=e.type),e.anisotropy!==void 0&&(n.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(n.colorSpace=e.colorSpace),e.flipY!==void 0&&(n.flipY=e.flipY),e.generateMipmaps!==void 0&&(n.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(n.internalFormat=e.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(n)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,n,i=1){if(this.width!==e||this.height!==n||this.depth!==i){this.width=e,this.height=n,this.depth=i;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=e,this.textures[s].image.height=n,this.textures[s].image.depth=i,this.textures[s].isArrayTexture=this.textures[s].image.depth>1;this.dispose()}this.viewport.set(0,0,e,n),this.scissor.set(0,0,e,n)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,i=e.textures.length;n<i;n++){this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;let s=Object.assign({},e.textures[n].image);this.textures[n].source=new eo(s)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}},qt=class extends Ju{constructor(e=1,n=1,i={}){super(e,n,i),this.isWebGLRenderTarget=!0}},Rl=class extends Yt{constructor(e=null,n=1,i=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:n,height:i,depth:s},this.magFilter=ai,this.minFilter=ai,this.wrapR=Xs,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var ju=class extends Yt{constructor(e=null,n=1,i=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:n,height:i,depth:s},this.magFilter=ai,this.minFilter=ai,this.wrapR=Xs,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var qs=class{constructor(e=new z(1/0,1/0,1/0),n=new z(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=n}set(e,n){return this.min.copy(e),this.max.copy(n),this}setFromArray(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n+=3)this.expandByPoint(di.fromArray(e,n));return this}setFromBufferAttribute(e){this.makeEmpty();for(let n=0,i=e.count;n<i;n++)this.expandByPoint(di.fromBufferAttribute(e,n));return this}setFromPoints(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n++)this.expandByPoint(e[n]);return this}setFromCenterAndSize(e,n){let i=di.copy(n).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,n=!1){return this.makeEmpty(),this.expandByObject(e,n)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,n=!1){e.updateWorldMatrix(!1,!1);let i=e.geometry;if(i!==void 0){let r=i.getAttribute("position");if(n===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let a=0,o=r.count;a<o;a++)e.isMesh===!0?e.getVertexPosition(a,di):di.fromBufferAttribute(r,a),di.applyMatrix4(e.matrixWorld),this.expandByPoint(di);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Tu.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Tu.copy(i.boundingBox)),Tu.applyMatrix4(e.matrixWorld),this.union(Tu)}let s=e.children;for(let r=0,a=s.length;r<a;r++)this.expandByObject(s[r],n);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,n){return n.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,di),di.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let n,i;return e.normal.x>0?(n=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(n=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(n+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(n+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(n+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(n+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),n<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Al),bu.subVectors(this.max,Al),Ha.subVectors(e.a,Al),Ga.subVectors(e.b,Al),ka.subVectors(e.c,Al),Fs.subVectors(Ga,Ha),zs.subVectors(ka,Ga),br.subVectors(Ha,ka);let n=[0,-Fs.z,Fs.y,0,-zs.z,zs.y,0,-br.z,br.y,Fs.z,0,-Fs.x,zs.z,0,-zs.x,br.z,0,-br.x,-Fs.y,Fs.x,0,-zs.y,zs.x,0,-br.y,br.x,0];return!tm(n,Ha,Ga,ka,bu)||(n=[1,0,0,0,1,0,0,0,1],!tm(n,Ha,Ga,ka,bu))?!1:(wu.crossVectors(Fs,zs),n=[wu.x,wu.y,wu.z],tm(n,Ha,Ga,ka,bu))}clampPoint(e,n){return n.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,di).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(di).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(ns[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),ns[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),ns[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),ns[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),ns[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),ns[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),ns[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),ns[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(ns),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},ns=[new z,new z,new z,new z,new z,new z,new z,new z],di=new z,Tu=new qs,Ha=new z,Ga=new z,ka=new z,Fs=new z,zs=new z,br=new z,Al=new z,bu=new z,wu=new z,wr=new z;function tm(t,e,n,i,s){for(let r=0,a=t.length-3;r<=a;r+=3){wr.fromArray(t,r);let o=s.x*Math.abs(wr.x)+s.y*Math.abs(wr.y)+s.z*Math.abs(wr.z),l=e.dot(wr),c=n.dot(wr),f=i.dot(wr);if(Math.max(-Math.max(l,c,f),Math.min(l,c,f))>o)return!1}return!0}var sE=new qs,Sl=new z,nm=new z,to=class{constructor(e=new z,n=-1){this.isSphere=!0,this.center=e,this.radius=n}set(e,n){return this.center.copy(e),this.radius=n,this}setFromPoints(e,n){let i=this.center;n!==void 0?i.copy(n):sE.setFromPoints(e).getCenter(i);let s=0;for(let r=0,a=e.length;r<a;r++)s=Math.max(s,i.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let n=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=n*n}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,n){let i=this.center.distanceToSquared(e);return n.copy(e),i>this.radius*this.radius&&(n.sub(this.center).normalize(),n.multiplyScalar(this.radius).add(this.center)),n}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Sl.subVectors(e,this.center);let n=Sl.lengthSq();if(n>this.radius*this.radius){let i=Math.sqrt(n),s=(i-this.radius)*.5;this.center.addScaledVector(Sl,s/i),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(nm.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Sl.copy(e.center).add(nm)),this.expandByPoint(Sl.copy(e.center).sub(nm))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},is=new z,im=new z,Cu=new z,Hs=new z,sm=new z,Ru=new z,rm=new z,$u=class{constructor(e=new z,n=new z(0,0,-1)){this.origin=e,this.direction=n}set(e,n){return this.origin.copy(e),this.direction.copy(n),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,n){return n.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,is)),this}closestPointToPoint(e,n){n.subVectors(e,this.origin);let i=n.dot(this.direction);return i<0?n.copy(this.origin):n.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let n=is.subVectors(e,this.origin).dot(this.direction);return n<0?this.origin.distanceToSquared(e):(is.copy(this.origin).addScaledVector(this.direction,n),is.distanceToSquared(e))}distanceSqToSegment(e,n,i,s){im.copy(e).add(n).multiplyScalar(.5),Cu.copy(n).sub(e).normalize(),Hs.copy(this.origin).sub(im);let r=e.distanceTo(n)*.5,a=-this.direction.dot(Cu),o=Hs.dot(this.direction),l=-Hs.dot(Cu),c=Hs.lengthSq(),f=Math.abs(1-a*a),p,h,d,y;if(f>0)if(p=a*l-o,h=a*o-l,y=r*f,p>=0)if(h>=-y)if(h<=y){let _=1/f;p*=_,h*=_,d=p*(p+a*h+2*o)+h*(a*p+h+2*l)+c}else h=r,p=Math.max(0,-(a*h+o)),d=-p*p+h*(h+2*l)+c;else h=-r,p=Math.max(0,-(a*h+o)),d=-p*p+h*(h+2*l)+c;else h<=-y?(p=Math.max(0,-(-a*r+o)),h=p>0?-r:Math.min(Math.max(-r,-l),r),d=-p*p+h*(h+2*l)+c):h<=y?(p=0,h=Math.min(Math.max(-r,-l),r),d=h*(h+2*l)+c):(p=Math.max(0,-(a*r+o)),h=p>0?r:Math.min(Math.max(-r,-l),r),d=-p*p+h*(h+2*l)+c);else h=a>0?-r:r,p=Math.max(0,-(a*h+o)),d=-p*p+h*(h+2*l)+c;return i&&i.copy(this.origin).addScaledVector(this.direction,p),s&&s.copy(im).addScaledVector(Cu,h),d}intersectSphere(e,n){is.subVectors(e.center,this.origin);let i=is.dot(this.direction),s=is.dot(is)-i*i,r=e.radius*e.radius;if(s>r)return null;let a=Math.sqrt(r-s),o=i-a,l=i+a;return l<0?null:o<0?this.at(l,n):this.at(o,n)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let n=e.normal.dot(this.direction);if(n===0)return e.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(e.normal)+e.constant)/n;return i>=0?i:null}intersectPlane(e,n){let i=this.distanceToPlane(e);return i===null?null:this.at(i,n)}intersectsPlane(e){let n=e.distanceToPoint(this.origin);return n===0||e.normal.dot(this.direction)*n<0}intersectBox(e,n){let i,s,r,a,o,l,c=1/this.direction.x,f=1/this.direction.y,p=1/this.direction.z,h=this.origin;return c>=0?(i=(e.min.x-h.x)*c,s=(e.max.x-h.x)*c):(i=(e.max.x-h.x)*c,s=(e.min.x-h.x)*c),f>=0?(r=(e.min.y-h.y)*f,a=(e.max.y-h.y)*f):(r=(e.max.y-h.y)*f,a=(e.min.y-h.y)*f),i>a||r>s||((r>i||isNaN(i))&&(i=r),(a<s||isNaN(s))&&(s=a),p>=0?(o=(e.min.z-h.z)*p,l=(e.max.z-h.z)*p):(o=(e.max.z-h.z)*p,l=(e.min.z-h.z)*p),i>l||o>s)||((o>i||i!==i)&&(i=o),(l<s||s!==s)&&(s=l),s<0)?null:this.at(i>=0?i:s,n)}intersectsBox(e){return this.intersectBox(e,is)!==null}intersectTriangle(e,n,i,s,r){sm.subVectors(n,e),Ru.subVectors(i,e),rm.crossVectors(sm,Ru);let a=this.direction.dot(rm),o;if(a>0){if(s)return null;o=1}else if(a<0)o=-1,a=-a;else return null;Hs.subVectors(this.origin,e);let l=o*this.direction.dot(Ru.crossVectors(Hs,Ru));if(l<0)return null;let c=o*this.direction.dot(sm.cross(Hs));if(c<0||l+c>a)return null;let f=-o*Hs.dot(rm);return f<0?null:this.at(f/a,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Xt=class t{constructor(e,n,i,s,r,a,o,l,c,f,p,h,d,y,_,m){t.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,n,i,s,r,a,o,l,c,f,p,h,d,y,_,m)}set(e,n,i,s,r,a,o,l,c,f,p,h,d,y,_,m){let u=this.elements;return u[0]=e,u[4]=n,u[8]=i,u[12]=s,u[1]=r,u[5]=a,u[9]=o,u[13]=l,u[2]=c,u[6]=f,u[10]=p,u[14]=h,u[3]=d,u[7]=y,u[11]=_,u[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new t().fromArray(this.elements)}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],n[9]=i[9],n[10]=i[10],n[11]=i[11],n[12]=i[12],n[13]=i[13],n[14]=i[14],n[15]=i[15],this}copyPosition(e){let n=this.elements,i=e.elements;return n[12]=i[12],n[13]=i[13],n[14]=i[14],this}setFromMatrix3(e){let n=e.elements;return this.set(n[0],n[3],n[6],0,n[1],n[4],n[7],0,n[2],n[5],n[8],0,0,0,0,1),this}extractBasis(e,n,i){return e.setFromMatrixColumn(this,0),n.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this}makeBasis(e,n,i){return this.set(e.x,n.x,i.x,0,e.y,n.y,i.y,0,e.z,n.z,i.z,0,0,0,0,1),this}extractRotation(e){let n=this.elements,i=e.elements,s=1/Va.setFromMatrixColumn(e,0).length(),r=1/Va.setFromMatrixColumn(e,1).length(),a=1/Va.setFromMatrixColumn(e,2).length();return n[0]=i[0]*s,n[1]=i[1]*s,n[2]=i[2]*s,n[3]=0,n[4]=i[4]*r,n[5]=i[5]*r,n[6]=i[6]*r,n[7]=0,n[8]=i[8]*a,n[9]=i[9]*a,n[10]=i[10]*a,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromEuler(e){let n=this.elements,i=e.x,s=e.y,r=e.z,a=Math.cos(i),o=Math.sin(i),l=Math.cos(s),c=Math.sin(s),f=Math.cos(r),p=Math.sin(r);if(e.order==="XYZ"){let h=a*f,d=a*p,y=o*f,_=o*p;n[0]=l*f,n[4]=-l*p,n[8]=c,n[1]=d+y*c,n[5]=h-_*c,n[9]=-o*l,n[2]=_-h*c,n[6]=y+d*c,n[10]=a*l}else if(e.order==="YXZ"){let h=l*f,d=l*p,y=c*f,_=c*p;n[0]=h+_*o,n[4]=y*o-d,n[8]=a*c,n[1]=a*p,n[5]=a*f,n[9]=-o,n[2]=d*o-y,n[6]=_+h*o,n[10]=a*l}else if(e.order==="ZXY"){let h=l*f,d=l*p,y=c*f,_=c*p;n[0]=h-_*o,n[4]=-a*p,n[8]=y+d*o,n[1]=d+y*o,n[5]=a*f,n[9]=_-h*o,n[2]=-a*c,n[6]=o,n[10]=a*l}else if(e.order==="ZYX"){let h=a*f,d=a*p,y=o*f,_=o*p;n[0]=l*f,n[4]=y*c-d,n[8]=h*c+_,n[1]=l*p,n[5]=_*c+h,n[9]=d*c-y,n[2]=-c,n[6]=o*l,n[10]=a*l}else if(e.order==="YZX"){let h=a*l,d=a*c,y=o*l,_=o*c;n[0]=l*f,n[4]=_-h*p,n[8]=y*p+d,n[1]=p,n[5]=a*f,n[9]=-o*f,n[2]=-c*f,n[6]=d*p+y,n[10]=h-_*p}else if(e.order==="XZY"){let h=a*l,d=a*c,y=o*l,_=o*c;n[0]=l*f,n[4]=-p,n[8]=c*f,n[1]=h*p+_,n[5]=a*f,n[9]=d*p-y,n[2]=y*p-d,n[6]=o*f,n[10]=_*p+h}return n[3]=0,n[7]=0,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromQuaternion(e){return this.compose(rE,e,aE)}lookAt(e,n,i){let s=this.elements;return Gn.subVectors(e,n),Gn.lengthSq()===0&&(Gn.z=1),Gn.normalize(),Gs.crossVectors(i,Gn),Gs.lengthSq()===0&&(Math.abs(i.z)===1?Gn.x+=1e-4:Gn.z+=1e-4,Gn.normalize(),Gs.crossVectors(i,Gn)),Gs.normalize(),Du.crossVectors(Gn,Gs),s[0]=Gs.x,s[4]=Du.x,s[8]=Gn.x,s[1]=Gs.y,s[5]=Du.y,s[9]=Gn.y,s[2]=Gs.z,s[6]=Du.z,s[10]=Gn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,s=n.elements,r=this.elements,a=i[0],o=i[4],l=i[8],c=i[12],f=i[1],p=i[5],h=i[9],d=i[13],y=i[2],_=i[6],m=i[10],u=i[14],g=i[3],v=i[7],x=i[11],T=i[15],C=s[0],w=s[4],D=s[8],E=s[12],M=s[1],U=s[5],G=s[9],V=s[13],Y=s[2],O=s[6],N=s[10],J=s[14],k=s[3],se=s[7],pe=s[11],Me=s[15];return r[0]=a*C+o*M+l*Y+c*k,r[4]=a*w+o*U+l*O+c*se,r[8]=a*D+o*G+l*N+c*pe,r[12]=a*E+o*V+l*J+c*Me,r[1]=f*C+p*M+h*Y+d*k,r[5]=f*w+p*U+h*O+d*se,r[9]=f*D+p*G+h*N+d*pe,r[13]=f*E+p*V+h*J+d*Me,r[2]=y*C+_*M+m*Y+u*k,r[6]=y*w+_*U+m*O+u*se,r[10]=y*D+_*G+m*N+u*pe,r[14]=y*E+_*V+m*J+u*Me,r[3]=g*C+v*M+x*Y+T*k,r[7]=g*w+v*U+x*O+T*se,r[11]=g*D+v*G+x*N+T*pe,r[15]=g*E+v*V+x*J+T*Me,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[4]*=e,n[8]*=e,n[12]*=e,n[1]*=e,n[5]*=e,n[9]*=e,n[13]*=e,n[2]*=e,n[6]*=e,n[10]*=e,n[14]*=e,n[3]*=e,n[7]*=e,n[11]*=e,n[15]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[4],s=e[8],r=e[12],a=e[1],o=e[5],l=e[9],c=e[13],f=e[2],p=e[6],h=e[10],d=e[14],y=e[3],_=e[7],m=e[11],u=e[15];return y*(+r*l*p-s*c*p-r*o*h+i*c*h+s*o*d-i*l*d)+_*(+n*l*d-n*c*h+r*a*h-s*a*d+s*c*f-r*l*f)+m*(+n*c*p-n*o*d-r*a*p+i*a*d+r*o*f-i*c*f)+u*(-s*o*f-n*l*p+n*o*h+s*a*p-i*a*h+i*l*f)}transpose(){let e=this.elements,n;return n=e[1],e[1]=e[4],e[4]=n,n=e[2],e[2]=e[8],e[8]=n,n=e[6],e[6]=e[9],e[9]=n,n=e[3],e[3]=e[12],e[12]=n,n=e[7],e[7]=e[13],e[13]=n,n=e[11],e[11]=e[14],e[14]=n,this}setPosition(e,n,i){let s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=n,s[14]=i),this}invert(){let e=this.elements,n=e[0],i=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],f=e[8],p=e[9],h=e[10],d=e[11],y=e[12],_=e[13],m=e[14],u=e[15],g=p*m*c-_*h*c+_*l*d-o*m*d-p*l*u+o*h*u,v=y*h*c-f*m*c-y*l*d+a*m*d+f*l*u-a*h*u,x=f*_*c-y*p*c+y*o*d-a*_*d-f*o*u+a*p*u,T=y*p*l-f*_*l-y*o*h+a*_*h+f*o*m-a*p*m,C=n*g+i*v+s*x+r*T;if(C===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let w=1/C;return e[0]=g*w,e[1]=(_*h*r-p*m*r-_*s*d+i*m*d+p*s*u-i*h*u)*w,e[2]=(o*m*r-_*l*r+_*s*c-i*m*c-o*s*u+i*l*u)*w,e[3]=(p*l*r-o*h*r-p*s*c+i*h*c+o*s*d-i*l*d)*w,e[4]=v*w,e[5]=(f*m*r-y*h*r+y*s*d-n*m*d-f*s*u+n*h*u)*w,e[6]=(y*l*r-a*m*r-y*s*c+n*m*c+a*s*u-n*l*u)*w,e[7]=(a*h*r-f*l*r+f*s*c-n*h*c-a*s*d+n*l*d)*w,e[8]=x*w,e[9]=(y*p*r-f*_*r-y*i*d+n*_*d+f*i*u-n*p*u)*w,e[10]=(a*_*r-y*o*r+y*i*c-n*_*c-a*i*u+n*o*u)*w,e[11]=(f*o*r-a*p*r-f*i*c+n*p*c+a*i*d-n*o*d)*w,e[12]=T*w,e[13]=(f*_*s-y*p*s+y*i*h-n*_*h-f*i*m+n*p*m)*w,e[14]=(y*o*s-a*_*s-y*i*l+n*_*l+a*i*m-n*o*m)*w,e[15]=(a*p*s-f*o*s+f*i*l-n*p*l-a*i*h+n*o*h)*w,this}scale(e){let n=this.elements,i=e.x,s=e.y,r=e.z;return n[0]*=i,n[4]*=s,n[8]*=r,n[1]*=i,n[5]*=s,n[9]*=r,n[2]*=i,n[6]*=s,n[10]*=r,n[3]*=i,n[7]*=s,n[11]*=r,this}getMaxScaleOnAxis(){let e=this.elements,n=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(n,i,s))}makeTranslation(e,n,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,n,0,0,1,i,0,0,0,1),this}makeRotationX(e){let n=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,n,-i,0,0,i,n,0,0,0,0,1),this}makeRotationY(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,0,i,0,0,1,0,0,-i,0,n,0,0,0,0,1),this}makeRotationZ(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,0,i,n,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,n){let i=Math.cos(n),s=Math.sin(n),r=1-i,a=e.x,o=e.y,l=e.z,c=r*a,f=r*o;return this.set(c*a+i,c*o-s*l,c*l+s*o,0,c*o+s*l,f*o+i,f*l-s*a,0,c*l-s*o,f*l+s*a,r*l*l+i,0,0,0,0,1),this}makeScale(e,n,i){return this.set(e,0,0,0,0,n,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,n,i,s,r,a){return this.set(1,i,r,0,e,1,a,0,n,s,1,0,0,0,0,1),this}compose(e,n,i){let s=this.elements,r=n._x,a=n._y,o=n._z,l=n._w,c=r+r,f=a+a,p=o+o,h=r*c,d=r*f,y=r*p,_=a*f,m=a*p,u=o*p,g=l*c,v=l*f,x=l*p,T=i.x,C=i.y,w=i.z;return s[0]=(1-(_+u))*T,s[1]=(d+x)*T,s[2]=(y-v)*T,s[3]=0,s[4]=(d-x)*C,s[5]=(1-(h+u))*C,s[6]=(m+g)*C,s[7]=0,s[8]=(y+v)*w,s[9]=(m-g)*w,s[10]=(1-(h+_))*w,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,n,i){let s=this.elements,r=Va.set(s[0],s[1],s[2]).length(),a=Va.set(s[4],s[5],s[6]).length(),o=Va.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),e.x=s[12],e.y=s[13],e.z=s[14],pi.copy(this);let c=1/r,f=1/a,p=1/o;return pi.elements[0]*=c,pi.elements[1]*=c,pi.elements[2]*=c,pi.elements[4]*=f,pi.elements[5]*=f,pi.elements[6]*=f,pi.elements[8]*=p,pi.elements[9]*=p,pi.elements[10]*=p,n.setFromRotationMatrix(pi),i.x=r,i.y=a,i.z=o,this}makePerspective(e,n,i,s,r,a,o=gi,l=!1){let c=this.elements,f=2*r/(n-e),p=2*r/(i-s),h=(n+e)/(n-e),d=(i+s)/(i-s),y,_;if(l)y=r/(a-r),_=a*r/(a-r);else if(o===gi)y=-(a+r)/(a-r),_=-2*a*r/(a-r);else if(o===wl)y=-a/(a-r),_=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return c[0]=f,c[4]=0,c[8]=h,c[12]=0,c[1]=0,c[5]=p,c[9]=d,c[13]=0,c[2]=0,c[6]=0,c[10]=y,c[14]=_,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,n,i,s,r,a,o=gi,l=!1){let c=this.elements,f=2/(n-e),p=2/(i-s),h=-(n+e)/(n-e),d=-(i+s)/(i-s),y,_;if(l)y=1/(a-r),_=a/(a-r);else if(o===gi)y=-2/(a-r),_=-(a+r)/(a-r);else if(o===wl)y=-1/(a-r),_=-r/(a-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return c[0]=f,c[4]=0,c[8]=0,c[12]=h,c[1]=0,c[5]=p,c[9]=0,c[13]=d,c[2]=0,c[6]=0,c[10]=y,c[14]=_,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let n=this.elements,i=e.elements;for(let s=0;s<16;s++)if(n[s]!==i[s])return!1;return!0}fromArray(e,n=0){for(let i=0;i<16;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e[n+9]=i[9],e[n+10]=i[10],e[n+11]=i[11],e[n+12]=i[12],e[n+13]=i[13],e[n+14]=i[14],e[n+15]=i[15],e}},Va=new z,pi=new Xt,rE=new z(0,0,0),aE=new z(1,1,1),Gs=new z,Du=new z,Gn=new z,l_=new Xt,c_=new ls,Ii=class t{constructor(e=0,n=0,i=0,s=t.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=n,this._z=i,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,n,i,s=this._order){return this._x=e,this._y=n,this._z=i,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,n=this._order,i=!0){let s=e.elements,r=s[0],a=s[4],o=s[8],l=s[1],c=s[5],f=s[9],p=s[2],h=s[6],d=s[10];switch(n){case"XYZ":this._y=Math.asin(Ye(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-f,d),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(h,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Ye(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(o,d),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-p,r),this._z=0);break;case"ZXY":this._x=Math.asin(Ye(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(-p,d),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-Ye(p,-1,1)),Math.abs(p)<.9999999?(this._x=Math.atan2(h,d),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-a,c));break;case"YZX":this._z=Math.asin(Ye(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-f,c),this._y=Math.atan2(-p,r)):(this._x=0,this._y=Math.atan2(o,d));break;case"XZY":this._z=Math.asin(-Ye(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(h,c),this._y=Math.atan2(o,r)):(this._x=Math.atan2(-f,d),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+n)}return this._order=n,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,n,i){return l_.makeRotationFromQuaternion(e),this.setFromRotationMatrix(l_,n,i)}setFromVector3(e,n=this._order){return this.set(e.x,e.y,e.z,n)}reorder(e){return c_.setFromEuler(this),this.setFromQuaternion(c_,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Ii.DEFAULT_ORDER="XYZ";var Dl=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},oE=0,u_=new z,Wa=new ls,ss=new Xt,Uu=new z,Ml=new z,lE=new z,cE=new ls,f_=new z(1,0,0),h_=new z(0,1,0),d_=new z(0,0,1),p_={type:"added"},uE={type:"removed"},Xa={type:"childadded",child:null},am={type:"childremoved",child:null},oi=class t extends Vn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:oE++}),this.uuid=ql(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=t.DEFAULT_UP.clone();let e=new z,n=new Ii,i=new ls,s=new z(1,1,1);function r(){i.setFromEuler(n,!1)}function a(){n.setFromQuaternion(i,void 0,!1)}n._onChange(r),i._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new Xt},normalMatrix:{value:new Ne}}),this.matrix=new Xt,this.matrixWorld=new Xt,this.matrixAutoUpdate=t.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=t.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Dl,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,n){this.quaternion.setFromAxisAngle(e,n)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,n){return Wa.setFromAxisAngle(e,n),this.quaternion.multiply(Wa),this}rotateOnWorldAxis(e,n){return Wa.setFromAxisAngle(e,n),this.quaternion.premultiply(Wa),this}rotateX(e){return this.rotateOnAxis(f_,e)}rotateY(e){return this.rotateOnAxis(h_,e)}rotateZ(e){return this.rotateOnAxis(d_,e)}translateOnAxis(e,n){return u_.copy(e).applyQuaternion(this.quaternion),this.position.add(u_.multiplyScalar(n)),this}translateX(e){return this.translateOnAxis(f_,e)}translateY(e){return this.translateOnAxis(h_,e)}translateZ(e){return this.translateOnAxis(d_,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(ss.copy(this.matrixWorld).invert())}lookAt(e,n,i){e.isVector3?Uu.copy(e):Uu.set(e,n,i);let s=this.parent;this.updateWorldMatrix(!0,!1),Ml.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?ss.lookAt(Ml,Uu,this.up):ss.lookAt(Uu,Ml,this.up),this.quaternion.setFromRotationMatrix(ss),s&&(ss.extractRotation(s.matrixWorld),Wa.setFromRotationMatrix(ss),this.quaternion.premultiply(Wa.invert()))}add(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.add(arguments[n]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(p_),Xa.child=e,this.dispatchEvent(Xa),Xa.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let n=this.children.indexOf(e);return n!==-1&&(e.parent=null,this.children.splice(n,1),e.dispatchEvent(uE),am.child=e,this.dispatchEvent(am),am.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),ss.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),ss.multiply(e.parent.matrixWorld)),e.applyMatrix4(ss),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(p_),Xa.child=e,this.dispatchEvent(Xa),Xa.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,n){if(this[e]===n)return this;for(let i=0,s=this.children.length;i<s;i++){let a=this.children[i].getObjectByProperty(e,n);if(a!==void 0)return a}}getObjectsByProperty(e,n,i=[]){this[e]===n&&i.push(this);let s=this.children;for(let r=0,a=s.length;r<a;r++)s[r].getObjectsByProperty(e,n,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ml,e,lE),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ml,cE,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let n=this.matrixWorld.elements;return e.set(n[8],n[9],n[10]).normalize()}raycast(){}traverse(e){e(this);let n=this.children;for(let i=0,s=n.length;i<s;i++)n[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let n=this.children;for(let i=0,s=n.length;i<s;i++)n[i].traverseVisible(e)}traverseAncestors(e){let n=this.parent;n!==null&&(e(n),n.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let n=this.children;for(let i=0,s=n.length;i<s;i++)n[i].updateMatrixWorld(e)}updateWorldMatrix(e,n){let i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),n===!0){let s=this.children;for(let r=0,a=s.length;r<a;r++)s[r].updateWorldMatrix(!1,!0)}}toJSON(e){let n=e===void 0||typeof e=="string",i={};n&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),s.instanceInfo=this._instanceInfo.map(o=>({...o})),s.availableInstanceIds=this._availableInstanceIds.slice(),s.availableGeometryIds=this._availableGeometryIds.slice(),s.nextIndexStart=this._nextIndexStart,s.nextVertexStart=this._nextVertexStart,s.geometryCount=this._geometryCount,s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.matricesTexture=this._matricesTexture.toJSON(e),s.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(s.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(s.boundingBox=this.boundingBox.toJSON()));function r(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);let o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){let l=o.shapes;if(Array.isArray(l))for(let c=0,f=l.length;c<f;c++){let p=l[c];r(e.shapes,p)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(r(e.materials,this.material[l]));s.material=o}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let o=0;o<this.children.length;o++)s.children.push(this.children[o].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let o=0;o<this.animations.length;o++){let l=this.animations[o];s.animations.push(r(e.animations,l))}}if(n){let o=a(e.geometries),l=a(e.materials),c=a(e.textures),f=a(e.images),p=a(e.shapes),h=a(e.skeletons),d=a(e.animations),y=a(e.nodes);o.length>0&&(i.geometries=o),l.length>0&&(i.materials=l),c.length>0&&(i.textures=c),f.length>0&&(i.images=f),p.length>0&&(i.shapes=p),h.length>0&&(i.skeletons=h),d.length>0&&(i.animations=d),y.length>0&&(i.nodes=y)}return i.object=s,i;function a(o){let l=[];for(let c in o){let f=o[c];delete f.metadata,l.push(f)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,n=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),n===!0)for(let i=0;i<e.children.length;i++){let s=e.children[i];this.add(s.clone())}return this}};oi.DEFAULT_UP=new z(0,1,0);oi.DEFAULT_MATRIX_AUTO_UPDATE=!0;oi.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var mi=new z,rs=new z,om=new z,as=new z,Ya=new z,qa=new z,m_=new z,lm=new z,cm=new z,um=new z,fm=new Bt,hm=new Bt,dm=new Bt,Ws=class t{constructor(e=new z,n=new z,i=new z){this.a=e,this.b=n,this.c=i}static getNormal(e,n,i,s){s.subVectors(i,n),mi.subVectors(e,n),s.cross(mi);let r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,n,i,s,r){mi.subVectors(s,n),rs.subVectors(i,n),om.subVectors(e,n);let a=mi.dot(mi),o=mi.dot(rs),l=mi.dot(om),c=rs.dot(rs),f=rs.dot(om),p=a*c-o*o;if(p===0)return r.set(0,0,0),null;let h=1/p,d=(c*l-o*f)*h,y=(a*f-o*l)*h;return r.set(1-d-y,y,d)}static containsPoint(e,n,i,s){return this.getBarycoord(e,n,i,s,as)===null?!1:as.x>=0&&as.y>=0&&as.x+as.y<=1}static getInterpolation(e,n,i,s,r,a,o,l){return this.getBarycoord(e,n,i,s,as)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,as.x),l.addScaledVector(a,as.y),l.addScaledVector(o,as.z),l)}static getInterpolatedAttribute(e,n,i,s,r,a){return fm.setScalar(0),hm.setScalar(0),dm.setScalar(0),fm.fromBufferAttribute(e,n),hm.fromBufferAttribute(e,i),dm.fromBufferAttribute(e,s),a.setScalar(0),a.addScaledVector(fm,r.x),a.addScaledVector(hm,r.y),a.addScaledVector(dm,r.z),a}static isFrontFacing(e,n,i,s){return mi.subVectors(i,n),rs.subVectors(e,n),mi.cross(rs).dot(s)<0}set(e,n,i){return this.a.copy(e),this.b.copy(n),this.c.copy(i),this}setFromPointsAndIndices(e,n,i,s){return this.a.copy(e[n]),this.b.copy(e[i]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,n,i,s){return this.a.fromBufferAttribute(e,n),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return mi.subVectors(this.c,this.b),rs.subVectors(this.a,this.b),mi.cross(rs).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return t.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,n){return t.getBarycoord(e,this.a,this.b,this.c,n)}getInterpolation(e,n,i,s,r){return t.getInterpolation(e,this.a,this.b,this.c,n,i,s,r)}containsPoint(e){return t.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return t.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,n){let i=this.a,s=this.b,r=this.c,a,o;Ya.subVectors(s,i),qa.subVectors(r,i),lm.subVectors(e,i);let l=Ya.dot(lm),c=qa.dot(lm);if(l<=0&&c<=0)return n.copy(i);cm.subVectors(e,s);let f=Ya.dot(cm),p=qa.dot(cm);if(f>=0&&p<=f)return n.copy(s);let h=l*p-f*c;if(h<=0&&l>=0&&f<=0)return a=l/(l-f),n.copy(i).addScaledVector(Ya,a);um.subVectors(e,r);let d=Ya.dot(um),y=qa.dot(um);if(y>=0&&d<=y)return n.copy(r);let _=d*c-l*y;if(_<=0&&c>=0&&y<=0)return o=c/(c-y),n.copy(i).addScaledVector(qa,o);let m=f*y-d*p;if(m<=0&&p-f>=0&&d-y>=0)return m_.subVectors(r,s),o=(p-f)/(p-f+(d-y)),n.copy(s).addScaledVector(m_,o);let u=1/(m+_+h);return a=_*u,o=h*u,n.copy(i).addScaledVector(Ya,a).addScaledVector(qa,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},uA={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},ks={h:0,s:0,l:0},Bu={h:0,s:0,l:0};function pm(t,e,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?t+(e-t)*6*n:n<1/2?e:n<2/3?t+(e-t)*6*(2/3-n):t}var qe=class{constructor(e,n,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,n,i)}set(e,n,i){if(n===void 0&&i===void 0){let s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,n,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,n=At){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,je.colorSpaceToWorking(this,n),this}setRGB(e,n,i,s=je.workingColorSpace){return this.r=e,this.g=n,this.b=i,je.colorSpaceToWorking(this,s),this}setHSL(e,n,i,s=je.workingColorSpace){if(e=eE(e,1),n=Ye(n,0,1),i=Ye(i,0,1),n===0)this.r=this.g=this.b=i;else{let r=i<=.5?i*(1+n):i+n-i*n,a=2*i-r;this.r=pm(a,r,e+1/3),this.g=pm(a,r,e),this.b=pm(a,r,e-1/3)}return je.colorSpaceToWorking(this,s),this}setStyle(e,n=At){function i(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r,a=s[1],o=s[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,n);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,n);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,n);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){let r=s[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,n);if(a===6)return this.setHex(parseInt(r,16),n);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,n);return this}setColorName(e,n=At){let i=uA[e.toLowerCase()];return i!==void 0?this.setHex(i,n):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=os(e.r),this.g=os(e.g),this.b=os(e.b),this}copyLinearToSRGB(e){return this.r=Ja(e.r),this.g=Ja(e.g),this.b=Ja(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=At){return je.workingToColorSpace(hn.copy(this),e),Math.round(Ye(hn.r*255,0,255))*65536+Math.round(Ye(hn.g*255,0,255))*256+Math.round(Ye(hn.b*255,0,255))}getHexString(e=At){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,n=je.workingColorSpace){je.workingToColorSpace(hn.copy(this),n);let i=hn.r,s=hn.g,r=hn.b,a=Math.max(i,s,r),o=Math.min(i,s,r),l,c,f=(o+a)/2;if(o===a)l=0,c=0;else{let p=a-o;switch(c=f<=.5?p/(a+o):p/(2-a-o),a){case i:l=(s-r)/p+(s<r?6:0);break;case s:l=(r-i)/p+2;break;case r:l=(i-s)/p+4;break}l/=6}return e.h=l,e.s=c,e.l=f,e}getRGB(e,n=je.workingColorSpace){return je.workingToColorSpace(hn.copy(this),n),e.r=hn.r,e.g=hn.g,e.b=hn.b,e}getStyle(e=At){je.workingToColorSpace(hn.copy(this),e);let n=hn.r,i=hn.g,s=hn.b;return e!==At?`color(${e} ${n.toFixed(3)} ${i.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(n*255)},${Math.round(i*255)},${Math.round(s*255)})`}offsetHSL(e,n,i){return this.getHSL(ks),this.setHSL(ks.h+e,ks.s+n,ks.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,n){return this.r=e.r+n.r,this.g=e.g+n.g,this.b=e.b+n.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,n){return this.r+=(e.r-this.r)*n,this.g+=(e.g-this.g)*n,this.b+=(e.b-this.b)*n,this}lerpColors(e,n,i){return this.r=e.r+(n.r-e.r)*i,this.g=e.g+(n.g-e.g)*i,this.b=e.b+(n.b-e.b)*i,this}lerpHSL(e,n){this.getHSL(ks),e.getHSL(Bu);let i=Kp(ks.h,Bu.h,n),s=Kp(ks.s,Bu.s,n),r=Kp(ks.l,Bu.l,n);return this.setHSL(i,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let n=this.r,i=this.g,s=this.b,r=e.elements;return this.r=r[0]*n+r[3]*i+r[6]*s,this.g=r[1]*n+r[4]*i+r[7]*s,this.b=r[2]*n+r[5]*i+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,n=0){return this.r=e[n],this.g=e[n+1],this.b=e[n+2],this}toArray(e=[],n=0){return e[n]=this.r,e[n+1]=this.g,e[n+2]=this.b,e}fromBufferAttribute(e,n){return this.r=e.getX(n),this.g=e.getY(n),this.b=e.getZ(n),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},hn=new qe;qe.NAMES=uA;var fE=0,yi=class extends Vn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:fE++}),this.uuid=ql(),this.name="",this.type="Material",this.blending=Br,this.side=vi,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Wu,this.blendDst=Xu,this.blendEquation=Ys,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new qe(0,0,0),this.blendAlpha=0,this.depthFunc=Ir,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Am,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Dr,this.stencilZFail=Dr,this.stencilZPass=Dr,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let n in e){let i=e[n];if(i===void 0){console.warn(`THREE.Material: parameter '${n}' has value of undefined.`);continue}let s=this[n];if(s===void 0){console.warn(`THREE.Material: '${n}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(i):s&&s.isVector3&&i&&i.isVector3?s.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";n&&(e={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==Br&&(i.blending=this.blending),this.side!==vi&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==Wu&&(i.blendSrc=this.blendSrc),this.blendDst!==Xu&&(i.blendDst=this.blendDst),this.blendEquation!==Ys&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==Ir&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Am&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Dr&&(i.stencilFail=this.stencilFail),this.stencilZFail!==Dr&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==Dr&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function s(r){let a=[];for(let o in r){let l=r[o];delete l.metadata,a.push(l)}return a}if(n){let r=s(e.textures),a=s(e.images);r.length>0&&(i.textures=r),a.length>0&&(i.images=a)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let n=e.clippingPlanes,i=null;if(n!==null){let s=n.length;i=new Array(s);for(let r=0;r!==s;++r)i[r]=n[r].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}},Ul=class extends yi{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new qe(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ii,this.combine=Rm,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}};var zt=new z,Iu=new Le,hE=0,pn=class{constructor(e,n,i=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:hE++}),this.name="",this.array=e,this.itemSize=n,this.count=e!==void 0?e.length/n:0,this.normalized=i,this.usage=Sm,this.updateRanges=[],this.gpuType=li,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,n,i){e*=this.itemSize,i*=n.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=n.array[i+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let n=0,i=this.count;n<i;n++)Iu.fromBufferAttribute(this,n),Iu.applyMatrix3(e),this.setXY(n,Iu.x,Iu.y);else if(this.itemSize===3)for(let n=0,i=this.count;n<i;n++)zt.fromBufferAttribute(this,n),zt.applyMatrix3(e),this.setXYZ(n,zt.x,zt.y,zt.z);return this}applyMatrix4(e){for(let n=0,i=this.count;n<i;n++)zt.fromBufferAttribute(this,n),zt.applyMatrix4(e),this.setXYZ(n,zt.x,zt.y,zt.z);return this}applyNormalMatrix(e){for(let n=0,i=this.count;n<i;n++)zt.fromBufferAttribute(this,n),zt.applyNormalMatrix(e),this.setXYZ(n,zt.x,zt.y,zt.z);return this}transformDirection(e){for(let n=0,i=this.count;n<i;n++)zt.fromBufferAttribute(this,n),zt.transformDirection(e),this.setXYZ(n,zt.x,zt.y,zt.z);return this}set(e,n=0){return this.array.set(e,n),this}getComponent(e,n){let i=this.array[e*this.itemSize+n];return this.normalized&&(i=_l(i,this.array)),i}setComponent(e,n,i){return this.normalized&&(i=Rn(i,this.array)),this.array[e*this.itemSize+n]=i,this}getX(e){let n=this.array[e*this.itemSize];return this.normalized&&(n=_l(n,this.array)),n}setX(e,n){return this.normalized&&(n=Rn(n,this.array)),this.array[e*this.itemSize]=n,this}getY(e){let n=this.array[e*this.itemSize+1];return this.normalized&&(n=_l(n,this.array)),n}setY(e,n){return this.normalized&&(n=Rn(n,this.array)),this.array[e*this.itemSize+1]=n,this}getZ(e){let n=this.array[e*this.itemSize+2];return this.normalized&&(n=_l(n,this.array)),n}setZ(e,n){return this.normalized&&(n=Rn(n,this.array)),this.array[e*this.itemSize+2]=n,this}getW(e){let n=this.array[e*this.itemSize+3];return this.normalized&&(n=_l(n,this.array)),n}setW(e,n){return this.normalized&&(n=Rn(n,this.array)),this.array[e*this.itemSize+3]=n,this}setXY(e,n,i){return e*=this.itemSize,this.normalized&&(n=Rn(n,this.array),i=Rn(i,this.array)),this.array[e+0]=n,this.array[e+1]=i,this}setXYZ(e,n,i,s){return e*=this.itemSize,this.normalized&&(n=Rn(n,this.array),i=Rn(i,this.array),s=Rn(s,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=s,this}setXYZW(e,n,i,s,r){return e*=this.itemSize,this.normalized&&(n=Rn(n,this.array),i=Rn(i,this.array),s=Rn(s,this.array),r=Rn(r,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Sm&&(e.usage=this.usage),e}};var Bl=class extends pn{constructor(e,n,i){super(new Uint16Array(e),n,i)}};var Il=class extends pn{constructor(e,n,i){super(new Uint32Array(e),n,i)}};var Bi=class extends pn{constructor(e,n,i){super(new Float32Array(e),n,i)}},dE=0,ri=new Xt,mm=new oi,Qa=new z,kn=new qs,El=new qs,nn=new z,Pi=class t extends Vn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:dE++}),this.uuid=ql(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Hm(e)?Il:Bl)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,n){return this.attributes[e]=n,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,n,i=0){this.groups.push({start:e,count:n,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,n){this.drawRange.start=e,this.drawRange.count=n}applyMatrix4(e){let n=this.attributes.position;n!==void 0&&(n.applyMatrix4(e),n.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let r=new Ne().getNormalMatrix(e);i.applyNormalMatrix(r),i.needsUpdate=!0}let s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return ri.makeRotationFromQuaternion(e),this.applyMatrix4(ri),this}rotateX(e){return ri.makeRotationX(e),this.applyMatrix4(ri),this}rotateY(e){return ri.makeRotationY(e),this.applyMatrix4(ri),this}rotateZ(e){return ri.makeRotationZ(e),this.applyMatrix4(ri),this}translate(e,n,i){return ri.makeTranslation(e,n,i),this.applyMatrix4(ri),this}scale(e,n,i){return ri.makeScale(e,n,i),this.applyMatrix4(ri),this}lookAt(e){return mm.lookAt(e),mm.updateMatrix(),this.applyMatrix4(mm.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Qa).negate(),this.translate(Qa.x,Qa.y,Qa.z),this}setFromPoints(e){let n=this.getAttribute("position");if(n===void 0){let i=[];for(let s=0,r=e.length;s<r;s++){let a=e[s];i.push(a.x,a.y,a.z||0)}this.setAttribute("position",new Bi(i,3))}else{let i=Math.min(e.length,n.count);for(let s=0;s<i;s++){let r=e[s];n.setXYZ(s,r.x,r.y,r.z||0)}e.length>n.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),n.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new qs);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new z(-1/0,-1/0,-1/0),new z(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),n)for(let i=0,s=n.length;i<s;i++){let r=n[i];kn.setFromBufferAttribute(r),this.morphTargetsRelative?(nn.addVectors(this.boundingBox.min,kn.min),this.boundingBox.expandByPoint(nn),nn.addVectors(this.boundingBox.max,kn.max),this.boundingBox.expandByPoint(nn)):(this.boundingBox.expandByPoint(kn.min),this.boundingBox.expandByPoint(kn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new to);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new z,1/0);return}if(e){let i=this.boundingSphere.center;if(kn.setFromBufferAttribute(e),n)for(let r=0,a=n.length;r<a;r++){let o=n[r];El.setFromBufferAttribute(o),this.morphTargetsRelative?(nn.addVectors(kn.min,El.min),kn.expandByPoint(nn),nn.addVectors(kn.max,El.max),kn.expandByPoint(nn)):(kn.expandByPoint(El.min),kn.expandByPoint(El.max))}kn.getCenter(i);let s=0;for(let r=0,a=e.count;r<a;r++)nn.fromBufferAttribute(e,r),s=Math.max(s,i.distanceToSquared(nn));if(n)for(let r=0,a=n.length;r<a;r++){let o=n[r],l=this.morphTargetsRelative;for(let c=0,f=o.count;c<f;c++)nn.fromBufferAttribute(o,c),l&&(Qa.fromBufferAttribute(e,c),nn.add(Qa)),s=Math.max(s,i.distanceToSquared(nn))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,n=this.attributes;if(e===null||n.position===void 0||n.normal===void 0||n.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=n.position,s=n.normal,r=n.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new pn(new Float32Array(4*i.count),4));let a=this.getAttribute("tangent"),o=[],l=[];for(let D=0;D<i.count;D++)o[D]=new z,l[D]=new z;let c=new z,f=new z,p=new z,h=new Le,d=new Le,y=new Le,_=new z,m=new z;function u(D,E,M){c.fromBufferAttribute(i,D),f.fromBufferAttribute(i,E),p.fromBufferAttribute(i,M),h.fromBufferAttribute(r,D),d.fromBufferAttribute(r,E),y.fromBufferAttribute(r,M),f.sub(c),p.sub(c),d.sub(h),y.sub(h);let U=1/(d.x*y.y-y.x*d.y);isFinite(U)&&(_.copy(f).multiplyScalar(y.y).addScaledVector(p,-d.y).multiplyScalar(U),m.copy(p).multiplyScalar(d.x).addScaledVector(f,-y.x).multiplyScalar(U),o[D].add(_),o[E].add(_),o[M].add(_),l[D].add(m),l[E].add(m),l[M].add(m))}let g=this.groups;g.length===0&&(g=[{start:0,count:e.count}]);for(let D=0,E=g.length;D<E;++D){let M=g[D],U=M.start,G=M.count;for(let V=U,Y=U+G;V<Y;V+=3)u(e.getX(V+0),e.getX(V+1),e.getX(V+2))}let v=new z,x=new z,T=new z,C=new z;function w(D){T.fromBufferAttribute(s,D),C.copy(T);let E=o[D];v.copy(E),v.sub(T.multiplyScalar(T.dot(E))).normalize(),x.crossVectors(C,E);let U=x.dot(l[D])<0?-1:1;a.setXYZW(D,v.x,v.y,v.z,U)}for(let D=0,E=g.length;D<E;++D){let M=g[D],U=M.start,G=M.count;for(let V=U,Y=U+G;V<Y;V+=3)w(e.getX(V+0)),w(e.getX(V+1)),w(e.getX(V+2))}}computeVertexNormals(){let e=this.index,n=this.getAttribute("position");if(n!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new pn(new Float32Array(n.count*3),3),this.setAttribute("normal",i);else for(let h=0,d=i.count;h<d;h++)i.setXYZ(h,0,0,0);let s=new z,r=new z,a=new z,o=new z,l=new z,c=new z,f=new z,p=new z;if(e)for(let h=0,d=e.count;h<d;h+=3){let y=e.getX(h+0),_=e.getX(h+1),m=e.getX(h+2);s.fromBufferAttribute(n,y),r.fromBufferAttribute(n,_),a.fromBufferAttribute(n,m),f.subVectors(a,r),p.subVectors(s,r),f.cross(p),o.fromBufferAttribute(i,y),l.fromBufferAttribute(i,_),c.fromBufferAttribute(i,m),o.add(f),l.add(f),c.add(f),i.setXYZ(y,o.x,o.y,o.z),i.setXYZ(_,l.x,l.y,l.z),i.setXYZ(m,c.x,c.y,c.z)}else for(let h=0,d=n.count;h<d;h+=3)s.fromBufferAttribute(n,h+0),r.fromBufferAttribute(n,h+1),a.fromBufferAttribute(n,h+2),f.subVectors(a,r),p.subVectors(s,r),f.cross(p),i.setXYZ(h+0,f.x,f.y,f.z),i.setXYZ(h+1,f.x,f.y,f.z),i.setXYZ(h+2,f.x,f.y,f.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let n=0,i=e.count;n<i;n++)nn.fromBufferAttribute(e,n),nn.normalize(),e.setXYZ(n,nn.x,nn.y,nn.z)}toNonIndexed(){function e(o,l){let c=o.array,f=o.itemSize,p=o.normalized,h=new c.constructor(l.length*f),d=0,y=0;for(let _=0,m=l.length;_<m;_++){o.isInterleavedBufferAttribute?d=l[_]*o.data.stride+o.offset:d=l[_]*f;for(let u=0;u<f;u++)h[y++]=c[d++]}return new pn(h,f,p)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let n=new t,i=this.index.array,s=this.attributes;for(let o in s){let l=s[o],c=e(l,i);n.setAttribute(o,c)}let r=this.morphAttributes;for(let o in r){let l=[],c=r[o];for(let f=0,p=c.length;f<p;f++){let h=c[f],d=e(h,i);l.push(d)}n.morphAttributes[o]=l}n.morphTargetsRelative=this.morphTargetsRelative;let a=this.groups;for(let o=0,l=a.length;o<l;o++){let c=a[o];n.addGroup(c.start,c.count,c.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let n=this.index;n!==null&&(e.data.index={type:n.array.constructor.name,array:Array.prototype.slice.call(n.array)});let i=this.attributes;for(let l in i){let c=i[l];e.data.attributes[l]=c.toJSON(e.data)}let s={},r=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],f=[];for(let p=0,h=c.length;p<h;p++){let d=c[p];f.push(d.toJSON(e.data))}f.length>0&&(s[l]=f,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let n={};this.name=e.name;let i=e.index;i!==null&&this.setIndex(i.clone());let s=e.attributes;for(let c in s){let f=s[c];this.setAttribute(c,f.clone(n))}let r=e.morphAttributes;for(let c in r){let f=[],p=r[c];for(let h=0,d=p.length;h<d;h++)f.push(p[h].clone(n));this.morphAttributes[c]=f}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let c=0,f=a.length;c<f;c++){let p=a[c];this.addGroup(p.start,p.count,p.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}},g_=new Xt,Cr=new $u,Pu=new to,v_=new z,Lu=new z,Nu=new z,Ou=new z,gm=new z,Fu=new z,x_=new z,zu=new z,mn=class extends oi{constructor(e=new Pi,n=new Ul){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let s=n[i[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}getVertexPosition(e,n){let i=this.geometry,s=i.attributes.position,r=i.morphAttributes.position,a=i.morphTargetsRelative;n.fromBufferAttribute(s,e);let o=this.morphTargetInfluences;if(r&&o){Fu.set(0,0,0);for(let l=0,c=r.length;l<c;l++){let f=o[l],p=r[l];f!==0&&(gm.fromBufferAttribute(p,e),a?Fu.addScaledVector(gm,f):Fu.addScaledVector(gm.sub(n),f))}n.add(Fu)}return n}raycast(e,n){let i=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),Pu.copy(i.boundingSphere),Pu.applyMatrix4(r),Cr.copy(e.ray).recast(e.near),!(Pu.containsPoint(Cr.origin)===!1&&(Cr.intersectSphere(Pu,v_)===null||Cr.origin.distanceToSquared(v_)>(e.far-e.near)**2))&&(g_.copy(r).invert(),Cr.copy(e.ray).applyMatrix4(g_),!(i.boundingBox!==null&&Cr.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,n,Cr)))}_computeIntersections(e,n,i){let s,r=this.geometry,a=this.material,o=r.index,l=r.attributes.position,c=r.attributes.uv,f=r.attributes.uv1,p=r.attributes.normal,h=r.groups,d=r.drawRange;if(o!==null)if(Array.isArray(a))for(let y=0,_=h.length;y<_;y++){let m=h[y],u=a[m.materialIndex],g=Math.max(m.start,d.start),v=Math.min(o.count,Math.min(m.start+m.count,d.start+d.count));for(let x=g,T=v;x<T;x+=3){let C=o.getX(x),w=o.getX(x+1),D=o.getX(x+2);s=Hu(this,u,e,i,c,f,p,C,w,D),s&&(s.faceIndex=Math.floor(x/3),s.face.materialIndex=m.materialIndex,n.push(s))}}else{let y=Math.max(0,d.start),_=Math.min(o.count,d.start+d.count);for(let m=y,u=_;m<u;m+=3){let g=o.getX(m),v=o.getX(m+1),x=o.getX(m+2);s=Hu(this,a,e,i,c,f,p,g,v,x),s&&(s.faceIndex=Math.floor(m/3),n.push(s))}}else if(l!==void 0)if(Array.isArray(a))for(let y=0,_=h.length;y<_;y++){let m=h[y],u=a[m.materialIndex],g=Math.max(m.start,d.start),v=Math.min(l.count,Math.min(m.start+m.count,d.start+d.count));for(let x=g,T=v;x<T;x+=3){let C=x,w=x+1,D=x+2;s=Hu(this,u,e,i,c,f,p,C,w,D),s&&(s.faceIndex=Math.floor(x/3),s.face.materialIndex=m.materialIndex,n.push(s))}}else{let y=Math.max(0,d.start),_=Math.min(l.count,d.start+d.count);for(let m=y,u=_;m<u;m+=3){let g=m,v=m+1,x=m+2;s=Hu(this,a,e,i,c,f,p,g,v,x),s&&(s.faceIndex=Math.floor(m/3),n.push(s))}}}};function pE(t,e,n,i,s,r,a,o){let l;if(e.side===Gt?l=i.intersectTriangle(a,r,s,!0,o):l=i.intersectTriangle(s,r,a,e.side===vi,o),l===null)return null;zu.copy(o),zu.applyMatrix4(t.matrixWorld);let c=n.ray.origin.distanceTo(zu);return c<n.near||c>n.far?null:{distance:c,point:zu.clone(),object:t}}function Hu(t,e,n,i,s,r,a,o,l,c){t.getVertexPosition(o,Lu),t.getVertexPosition(l,Nu),t.getVertexPosition(c,Ou);let f=pE(t,e,n,i,Lu,Nu,Ou,x_);if(f){let p=new z;Ws.getBarycoord(x_,Lu,Nu,Ou,p),s&&(f.uv=Ws.getInterpolatedAttribute(s,o,l,c,p,new Le)),r&&(f.uv1=Ws.getInterpolatedAttribute(r,o,l,c,p,new Le)),a&&(f.normal=Ws.getInterpolatedAttribute(a,o,l,c,p,new z),f.normal.dot(i.direction)>0&&f.normal.multiplyScalar(-1));let h={a:o,b:l,c,normal:new z,materialIndex:0};Ws.getNormal(Lu,Nu,Ou,h.normal),f.face=h,f.barycoord=p}return f}var no=class t extends Pi{constructor(e=1,n=1,i=1,s=1,r=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:n,depth:i,widthSegments:s,heightSegments:r,depthSegments:a};let o=this;s=Math.floor(s),r=Math.floor(r),a=Math.floor(a);let l=[],c=[],f=[],p=[],h=0,d=0;y("z","y","x",-1,-1,i,n,e,a,r,0),y("z","y","x",1,-1,i,n,-e,a,r,1),y("x","z","y",1,1,e,i,n,s,a,2),y("x","z","y",1,-1,e,i,-n,s,a,3),y("x","y","z",1,-1,e,n,i,s,r,4),y("x","y","z",-1,-1,e,n,-i,s,r,5),this.setIndex(l),this.setAttribute("position",new Bi(c,3)),this.setAttribute("normal",new Bi(f,3)),this.setAttribute("uv",new Bi(p,2));function y(_,m,u,g,v,x,T,C,w,D,E){let M=x/w,U=T/D,G=x/2,V=T/2,Y=C/2,O=w+1,N=D+1,J=0,k=0,se=new z;for(let pe=0;pe<N;pe++){let Me=pe*U-V;for(let Fe=0;Fe<O;Fe++){let rt=Fe*M-G;se[_]=rt*g,se[m]=Me*v,se[u]=Y,c.push(se.x,se.y,se.z),se[_]=0,se[m]=0,se[u]=C>0?1:-1,f.push(se.x,se.y,se.z),p.push(Fe/w),p.push(1-pe/D),J+=1}}for(let pe=0;pe<D;pe++)for(let Me=0;Me<w;Me++){let Fe=h+Me+O*pe,rt=h+Me+O*(pe+1),ht=h+(Me+1)+O*(pe+1),Je=h+(Me+1)+O*pe;l.push(Fe,rt,Je),l.push(rt,ht,Je),k+=6}o.addGroup(d,k,E),d+=k,h+=J}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};function Fr(t){let e={};for(let n in t){e[n]={};for(let i in t[n]){let s=t[n][i];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[n][i]=null):e[n][i]=s.clone():Array.isArray(s)?e[n][i]=s.slice():e[n][i]=s}}return e}function gn(t){let e={};for(let n=0;n<t.length;n++){let i=Fr(t[n]);for(let s in i)e[s]=i[s]}return e}function mE(t){let e=[];for(let n=0;n<t.length;n++)e.push(t[n].clone());return e}function Gm(t){let e=t.getRenderTarget();return e===null?t.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:je.workingColorSpace}var fA={clone:Fr,merge:gn},gE=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,vE=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Qt=class extends yi{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=gE,this.fragmentShader=vE,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Fr(e.uniforms),this.uniformsGroups=mE(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){let n=super.toJSON(e);n.glslVersion=this.glslVersion,n.uniforms={};for(let s in this.uniforms){let a=this.uniforms[s].value;a&&a.isTexture?n.uniforms[s]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?n.uniforms[s]={type:"c",value:a.getHex()}:a&&a.isVector2?n.uniforms[s]={type:"v2",value:a.toArray()}:a&&a.isVector3?n.uniforms[s]={type:"v3",value:a.toArray()}:a&&a.isVector4?n.uniforms[s]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?n.uniforms[s]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?n.uniforms[s]={type:"m4",value:a.toArray()}:n.uniforms[s]={value:a}}Object.keys(this.defines).length>0&&(n.defines=this.defines),n.vertexShader=this.vertexShader,n.fragmentShader=this.fragmentShader,n.lights=this.lights,n.clipping=this.clipping;let i={};for(let s in this.extensions)this.extensions[s]===!0&&(i[s]=!0);return Object.keys(i).length>0&&(n.extensions=i),n}},Pl=class extends oi{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Xt,this.projectionMatrix=new Xt,this.projectionMatrixInverse=new Xt,this.coordinateSystem=gi,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,n){return super.copy(e,n),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,n){super.updateWorldMatrix(e,n),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}},Vs=new z,y_=new Le,__=new Le,dn=class extends Pl{constructor(e=50,n=1,i=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=s,this.focus=10,this.aspect=n,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let n=.5*this.getFilmHeight()/e;this.fov=Zu*2*Math.atan(n),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Zp*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Zu*2*Math.atan(Math.tan(Zp*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,n,i){Vs.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Vs.x,Vs.y).multiplyScalar(-e/Vs.z),Vs.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(Vs.x,Vs.y).multiplyScalar(-e/Vs.z)}getViewSize(e,n){return this.getViewBounds(e,y_,__),n.subVectors(__,y_)}setViewOffset(e,n,i,s,r,a){this.aspect=e/n,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,n=e*Math.tan(Zp*.5*this.fov)/this.zoom,i=2*n,s=this.aspect*i,r=-.5*s,a=this.view;if(this.view!==null&&this.view.enabled){let l=a.fullWidth,c=a.fullHeight;r+=a.offsetX*s/l,n-=a.offsetY*i/c,s*=a.width/l,i*=a.height/c}let o=this.filmOffset;o!==0&&(r+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,n,n-i,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.fov=this.fov,n.object.zoom=this.zoom,n.object.near=this.near,n.object.far=this.far,n.object.focus=this.focus,n.object.aspect=this.aspect,this.view!==null&&(n.object.view=Object.assign({},this.view)),n.object.filmGauge=this.filmGauge,n.object.filmOffset=this.filmOffset,n}},Za=-90,Ka=1,ef=class extends oi{constructor(e,n,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let s=new dn(Za,Ka,e,n);s.layers=this.layers,this.add(s);let r=new dn(Za,Ka,e,n);r.layers=this.layers,this.add(r);let a=new dn(Za,Ka,e,n);a.layers=this.layers,this.add(a);let o=new dn(Za,Ka,e,n);o.layers=this.layers,this.add(o);let l=new dn(Za,Ka,e,n);l.layers=this.layers,this.add(l);let c=new dn(Za,Ka,e,n);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,n=this.children.concat(),[i,s,r,a,o,l]=n;for(let c of n)this.remove(c);if(e===gi)i.up.set(0,1,0),i.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===wl)i.up.set(0,-1,0),i.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of n)this.add(c),c.updateMatrixWorld()}update(e,n){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[r,a,o,l,c,f]=this.children,p=e.getRenderTarget(),h=e.getActiveCubeFace(),d=e.getActiveMipmapLevel(),y=e.xr.enabled;e.xr.enabled=!1;let _=i.texture.generateMipmaps;i.texture.generateMipmaps=!1,e.setRenderTarget(i,0,s),e.render(n,r),e.setRenderTarget(i,1,s),e.render(n,a),e.setRenderTarget(i,2,s),e.render(n,o),e.setRenderTarget(i,3,s),e.render(n,l),e.setRenderTarget(i,4,s),e.render(n,c),i.texture.generateMipmaps=_,e.setRenderTarget(i,5,s),e.render(n,f),e.setRenderTarget(p,h,d),e.xr.enabled=y,i.texture.needsPMREMUpdate=!0}},Ll=class extends Yt{constructor(e=[],n=Nr,i,s,r,a,o,l,c,f){super(e,n,i,s,r,a,o,l,c,f),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},tf=class extends qt{constructor(e=1,n={}){super(e,e,n),this.isWebGLCubeRenderTarget=!0;let i={width:e,height:e,depth:1},s=[i,i,i,i,i,i];this.texture=new Ll(s),this._setTextureOptions(n),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,n){this.texture.type=n.type,this.texture.colorSpace=n.colorSpace,this.texture.generateMipmaps=n.generateMipmaps,this.texture.minFilter=n.minFilter,this.texture.magFilter=n.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new no(5,5,5),r=new Qt({name:"CubemapFromEquirect",uniforms:Fr(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:Gt,blending:Xn});r.uniforms.tEquirect.value=n;let a=new mn(s,r),o=n.minFilter;return n.minFilter===js&&(n.minFilter=Ht),new ef(1,10,this).update(e,a),n.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,n=!0,i=!0,s=!0){let r=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(n,i,s);e.setRenderTarget(r)}},Ur=class extends oi{constructor(){super(),this.isGroup=!0,this.type="Group"}},xE={type:"move"},io=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Ur,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Ur,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new z,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new z),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Ur,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new z,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new z),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let n=this._hand;if(n)for(let i of e.hand.values())this._getHandJoint(n,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,n,i){let s=null,r=null,a=null,o=this._targetRay,l=this._grip,c=this._hand;if(e&&n.session.visibilityState!=="visible-blurred"){if(c&&e.hand){a=!0;for(let _ of e.hand.values()){let m=n.getJointPose(_,i),u=this._getHandJoint(c,_);m!==null&&(u.matrix.fromArray(m.transform.matrix),u.matrix.decompose(u.position,u.rotation,u.scale),u.matrixWorldNeedsUpdate=!0,u.jointRadius=m.radius),u.visible=m!==null}let f=c.joints["index-finger-tip"],p=c.joints["thumb-tip"],h=f.position.distanceTo(p.position),d=.02,y=.005;c.inputState.pinching&&h>d+y?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&h<=d-y&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=n.getPose(e.gripSpace,i),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));o!==null&&(s=n.getPose(e.targetRaySpace,i),s===null&&r!==null&&(s=r),s!==null&&(o.matrix.fromArray(s.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,s.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(s.linearVelocity)):o.hasLinearVelocity=!1,s.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(s.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(xE)))}return o!==null&&(o.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(e,n){if(e.joints[n.jointName]===void 0){let i=new Ur;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[n.jointName]=i,e.add(i)}return e.joints[n.jointName]}};var Qs=class extends oi{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Ii,this.environmentIntensity=1,this.environmentRotation=new Ii,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,n){return super.copy(e,n),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let n=super.toJSON(e);return this.fog!==null&&(n.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(n.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(n.object.backgroundIntensity=this.backgroundIntensity),n.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(n.object.environmentIntensity=this.environmentIntensity),n.object.environmentRotation=this.environmentRotation.toArray(),n}};var vm=new z,yE=new z,_E=new Ne,Ui=class{constructor(e=new z(1,0,0),n=0){this.isPlane=!0,this.normal=e,this.constant=n}set(e,n){return this.normal.copy(e),this.constant=n,this}setComponents(e,n,i,s){return this.normal.set(e,n,i),this.constant=s,this}setFromNormalAndCoplanarPoint(e,n){return this.normal.copy(e),this.constant=-n.dot(this.normal),this}setFromCoplanarPoints(e,n,i){let s=vm.subVectors(i,n).cross(yE.subVectors(e,n)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,n){return n.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,n){let i=e.delta(vm),s=this.normal.dot(i);if(s===0)return this.distanceToPoint(e.start)===0?n.copy(e.start):null;let r=-(e.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:n.copy(e.start).addScaledVector(i,r)}intersectsLine(e){let n=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return n<0&&i>0||i<0&&n>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,n){let i=n||_E.getNormalMatrix(e),s=this.coplanarPoint(vm).applyMatrix4(e),r=this.normal.applyMatrix3(i).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},Rr=new to,AE=new Le(.5,.5),Gu=new z,Nl=class{constructor(e=new Ui,n=new Ui,i=new Ui,s=new Ui,r=new Ui,a=new Ui){this.planes=[e,n,i,s,r,a]}set(e,n,i,s,r,a){let o=this.planes;return o[0].copy(e),o[1].copy(n),o[2].copy(i),o[3].copy(s),o[4].copy(r),o[5].copy(a),this}copy(e){let n=this.planes;for(let i=0;i<6;i++)n[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,n=gi,i=!1){let s=this.planes,r=e.elements,a=r[0],o=r[1],l=r[2],c=r[3],f=r[4],p=r[5],h=r[6],d=r[7],y=r[8],_=r[9],m=r[10],u=r[11],g=r[12],v=r[13],x=r[14],T=r[15];if(s[0].setComponents(c-a,d-f,u-y,T-g).normalize(),s[1].setComponents(c+a,d+f,u+y,T+g).normalize(),s[2].setComponents(c+o,d+p,u+_,T+v).normalize(),s[3].setComponents(c-o,d-p,u-_,T-v).normalize(),i)s[4].setComponents(l,h,m,x).normalize(),s[5].setComponents(c-l,d-h,u-m,T-x).normalize();else if(s[4].setComponents(c-l,d-h,u-m,T-x).normalize(),n===gi)s[5].setComponents(c+l,d+h,u+m,T+x).normalize();else if(n===wl)s[5].setComponents(l,h,m,x).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+n);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Rr.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let n=e.geometry;n.boundingSphere===null&&n.computeBoundingSphere(),Rr.copy(n.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Rr)}intersectsSprite(e){Rr.center.set(0,0,0);let n=AE.distanceTo(e.center);return Rr.radius=.7071067811865476+n,Rr.applyMatrix4(e.matrixWorld),this.intersectsSphere(Rr)}intersectsSphere(e){let n=this.planes,i=e.center,s=-e.radius;for(let r=0;r<6;r++)if(n[r].distanceToPoint(i)<s)return!1;return!0}intersectsBox(e){let n=this.planes;for(let i=0;i<6;i++){let s=n[i];if(Gu.x=s.normal.x>0?e.max.x:e.min.x,Gu.y=s.normal.y>0?e.max.y:e.min.y,Gu.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(Gu)<0)return!1}return!0}containsPoint(e){let n=this.planes;for(let i=0;i<6;i++)if(n[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var cs=class extends Yt{constructor(e,n,i=$s,s,r,a,o=ai,l=ai,c,f=ja,p=1){if(f!==ja&&f!==tr)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let h={width:e,height:n,depth:p};super(h,s,r,a,o,l,f,i,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new eo(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let n=super.toJSON(e);return this.compareFunction!==null&&(n.compareFunction=this.compareFunction),n}},Ol=class extends Yt{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}};var Pr=class t extends Pi{constructor(e=1,n=1,i=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:n,widthSegments:i,heightSegments:s};let r=e/2,a=n/2,o=Math.floor(i),l=Math.floor(s),c=o+1,f=l+1,p=e/o,h=n/l,d=[],y=[],_=[],m=[];for(let u=0;u<f;u++){let g=u*h-a;for(let v=0;v<c;v++){let x=v*p-r;y.push(x,-g,0),_.push(0,0,1),m.push(v/o),m.push(1-u/l)}}for(let u=0;u<l;u++)for(let g=0;g<o;g++){let v=g+c*u,x=g+c*(u+1),T=g+1+c*(u+1),C=g+1+c*u;d.push(v,x,C),d.push(x,T,C)}this.setIndex(d),this.setAttribute("position",new Bi(y,3)),this.setAttribute("normal",new Bi(_,3)),this.setAttribute("uv",new Bi(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.widthSegments,e.heightSegments)}};var nf=class extends yi{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Ni,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},sf=class extends yi{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function ku(t,e){return!t||t.constructor===e?t:typeof e.BYTES_PER_ELEMENT=="number"?new e(t):Array.prototype.slice.call(t)}function SE(t){return ArrayBuffer.isView(t)&&!(t instanceof DataView)}var Lr=class{constructor(e,n,i,s){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=s!==void 0?s:new n.constructor(i),this.sampleValues=n,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(e){let n=this.parameterPositions,i=this._cachedIndex,s=n[i],r=n[i-1];e:{t:{let a;n:{i:if(!(e<s)){for(let o=i+2;;){if(s===void 0){if(e<r)break i;return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===o)break;if(r=s,s=n[++i],e<s)break t}a=n.length;break n}if(!(e>=r)){let o=n[1];e<o&&(i=2,r=o);for(let l=i-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(s=r,r=n[--i-1],e>=r)break t}a=i,i=0;break n}break e}for(;i<a;){let o=i+a>>>1;e<n[o]?a=o:i=o+1}if(s=n[i],r=n[i-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(s===void 0)return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,r,s)}return this.interpolate_(i,r,e,s)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let n=this.resultBuffer,i=this.sampleValues,s=this.valueSize,r=e*s;for(let a=0;a!==s;++a)n[a]=i[r+a];return n}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},rf=class extends Lr{constructor(e,n,i,s){super(e,n,i,s),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:xm,endingEnd:xm}}intervalChanged_(e,n,i){let s=this.parameterPositions,r=e-2,a=e+1,o=s[r],l=s[a];if(o===void 0)switch(this.getSettings_().endingStart){case ym:r=e,o=2*n-i;break;case _m:r=s.length-2,o=n+s[r]-s[r+1];break;default:r=e,o=i}if(l===void 0)switch(this.getSettings_().endingEnd){case ym:a=e,l=2*i-n;break;case _m:a=1,l=i+s[1]-s[0];break;default:a=e-1,l=n}let c=(i-n)*.5,f=this.valueSize;this._weightPrev=c/(n-o),this._weightNext=c/(l-i),this._offsetPrev=r*f,this._offsetNext=a*f}interpolate_(e,n,i,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,f=this._offsetPrev,p=this._offsetNext,h=this._weightPrev,d=this._weightNext,y=(i-n)/(s-n),_=y*y,m=_*y,u=-h*m+2*h*_-h*y,g=(1+h)*m+(-1.5-2*h)*_+(-.5+h)*y+1,v=(-1-d)*m+(1.5+d)*_+.5*y,x=d*m-d*_;for(let T=0;T!==o;++T)r[T]=u*a[f+T]+g*a[c+T]+v*a[l+T]+x*a[p+T];return r}},af=class extends Lr{constructor(e,n,i,s){super(e,n,i,s)}interpolate_(e,n,i,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,f=(i-n)/(s-n),p=1-f;for(let h=0;h!==o;++h)r[h]=a[c+h]*p+a[l+h]*f;return r}},of=class extends Lr{constructor(e,n,i,s){super(e,n,i,s)}interpolate_(e){return this.copySampleValue_(e-1)}},Wn=class{constructor(e,n,i,s){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(n===void 0||n.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=ku(n,this.TimeBufferType),this.values=ku(i,this.ValueBufferType),this.setInterpolation(s||this.DefaultInterpolation)}static toJSON(e){let n=e.constructor,i;if(n.toJSON!==this.toJSON)i=n.toJSON(e);else{i={name:e.name,times:ku(e.times,Array),values:ku(e.values,Array)};let s=e.getInterpolation();s!==e.DefaultInterpolation&&(i.interpolation=s)}return i.type=e.ValueTypeName,i}InterpolantFactoryMethodDiscrete(e){return new of(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new af(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new rf(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let n;switch(e){case Tl:n=this.InterpolantFactoryMethodDiscrete;break;case Qu:n=this.InterpolantFactoryMethodLinear;break;case Vu:n=this.InterpolantFactoryMethodSmooth;break}if(n===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return console.warn("THREE.KeyframeTrack:",i),this}return this.createInterpolant=n,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Tl;case this.InterpolantFactoryMethodLinear:return Qu;case this.InterpolantFactoryMethodSmooth:return Vu}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let n=this.times;for(let i=0,s=n.length;i!==s;++i)n[i]+=e}return this}scale(e){if(e!==1){let n=this.times;for(let i=0,s=n.length;i!==s;++i)n[i]*=e}return this}trim(e,n){let i=this.times,s=i.length,r=0,a=s-1;for(;r!==s&&i[r]<e;)++r;for(;a!==-1&&i[a]>n;)--a;if(++a,r!==0||a!==s){r>=a&&(a=Math.max(a,1),r=a-1);let o=this.getValueSize();this.times=i.slice(r,a),this.values=this.values.slice(r*o,a*o)}return this}validate(){let e=!0,n=this.getValueSize();n-Math.floor(n)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);let i=this.times,s=this.values,r=i.length;r===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let a=null;for(let o=0;o!==r;o++){let l=i[o];if(typeof l=="number"&&isNaN(l)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,o,l),e=!1;break}if(a!==null&&a>l){console.error("THREE.KeyframeTrack: Out of order keys.",this,o,l,a),e=!1;break}a=l}if(s!==void 0&&SE(s))for(let o=0,l=s.length;o!==l;++o){let c=s[o];if(isNaN(c)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,o,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),n=this.values.slice(),i=this.getValueSize(),s=this.getInterpolation()===Vu,r=e.length-1,a=1;for(let o=1;o<r;++o){let l=!1,c=e[o],f=e[o+1];if(c!==f&&(o!==1||c!==e[0]))if(s)l=!0;else{let p=o*i,h=p-i,d=p+i;for(let y=0;y!==i;++y){let _=n[p+y];if(_!==n[h+y]||_!==n[d+y]){l=!0;break}}}if(l){if(o!==a){e[a]=e[o];let p=o*i,h=a*i;for(let d=0;d!==i;++d)n[h+d]=n[p+d]}++a}}if(r>0){e[a]=e[r];for(let o=r*i,l=a*i,c=0;c!==i;++c)n[l+c]=n[o+c];++a}return a!==e.length?(this.times=e.slice(0,a),this.values=n.slice(0,a*i)):(this.times=e,this.values=n),this}clone(){let e=this.times.slice(),n=this.values.slice(),i=this.constructor,s=new i(this.name,e,n);return s.createInterpolant=this.createInterpolant,s}};Wn.prototype.ValueTypeName="";Wn.prototype.TimeBufferType=Float32Array;Wn.prototype.ValueBufferType=Float32Array;Wn.prototype.DefaultInterpolation=Qu;var Zs=class extends Wn{constructor(e,n,i){super(e,n,i)}};Zs.prototype.ValueTypeName="bool";Zs.prototype.ValueBufferType=Array;Zs.prototype.DefaultInterpolation=Tl;Zs.prototype.InterpolantFactoryMethodLinear=void 0;Zs.prototype.InterpolantFactoryMethodSmooth=void 0;var lf=class extends Wn{constructor(e,n,i,s){super(e,n,i,s)}};lf.prototype.ValueTypeName="color";var cf=class extends Wn{constructor(e,n,i,s){super(e,n,i,s)}};cf.prototype.ValueTypeName="number";var uf=class extends Lr{constructor(e,n,i,s){super(e,n,i,s)}interpolate_(e,n,i,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=(i-n)/(s-n),c=e*o;for(let f=c+o;c!==f;c+=4)ls.slerpFlat(r,0,a,c-o,a,c,l);return r}},Fl=class extends Wn{constructor(e,n,i,s){super(e,n,i,s)}InterpolantFactoryMethodLinear(e){return new uf(this.times,this.values,this.getValueSize(),e)}};Fl.prototype.ValueTypeName="quaternion";Fl.prototype.InterpolantFactoryMethodSmooth=void 0;var Ks=class extends Wn{constructor(e,n,i){super(e,n,i)}};Ks.prototype.ValueTypeName="string";Ks.prototype.ValueBufferType=Array;Ks.prototype.DefaultInterpolation=Tl;Ks.prototype.InterpolantFactoryMethodLinear=void 0;Ks.prototype.InterpolantFactoryMethodSmooth=void 0;var ff=class extends Wn{constructor(e,n,i,s){super(e,n,i,s)}};ff.prototype.ValueTypeName="vector";var hf=class{constructor(e,n,i){let s=this,r=!1,a=0,o=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=n,this.onError=i,this.abortController=new AbortController,this.itemStart=function(f){o++,r===!1&&s.onStart!==void 0&&s.onStart(f,a,o),r=!0},this.itemEnd=function(f){a++,s.onProgress!==void 0&&s.onProgress(f,a,o),a===o&&(r=!1,s.onLoad!==void 0&&s.onLoad())},this.itemError=function(f){s.onError!==void 0&&s.onError(f)},this.resolveURL=function(f){return l?l(f):f},this.setURLModifier=function(f){return l=f,this},this.addHandler=function(f,p){return c.push(f,p),this},this.removeHandler=function(f){let p=c.indexOf(f);return p!==-1&&c.splice(p,2),this},this.getHandler=function(f){for(let p=0,h=c.length;p<h;p+=2){let d=c[p],y=c[p+1];if(d.global&&(d.lastIndex=0),d.test(f))return y}return null},this.abort=function(){return this.abortController.abort(),this.abortController=new AbortController,this}}},hA=new hf,df=class{constructor(e){this.manager=e!==void 0?e:hA,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,n){let i=this;return new Promise(function(s,r){i.load(e,s,n,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};df.DEFAULT_MATERIAL_NAME="__DEFAULT";var Js=class extends Pl{constructor(e=-1,n=1,i=1,s=-1,r=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=n,this.top=i,this.bottom=s,this.near=r,this.far=a,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,n,i,s,r,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),n=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,s=(this.top+this.bottom)/2,r=i-e,a=i+e,o=s+n,l=s-n;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,f=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,a=r+c*this.view.width,o-=f*this.view.offsetY,l=o-f*this.view.height}this.projectionMatrix.makeOrthographic(r,a,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.zoom=this.zoom,n.object.left=this.left,n.object.right=this.right,n.object.top=this.top,n.object.bottom=this.bottom,n.object.near=this.near,n.object.far=this.far,this.view!==null&&(n.object.view=Object.assign({},this.view)),n}};var pf=class extends dn{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}},zl=class{constructor(e=!0){this.autoStart=e,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1}start(){this.startTime=performance.now(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let e=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){let n=performance.now();e=(n-this.oldTime)/1e3,this.oldTime=n,this.elapsedTime+=e}return e}};var km="\\[\\]\\.:\\/",ME=new RegExp("["+km+"]","g"),Vm="[^"+km+"]",EE="[^"+km.replace("\\.","")+"]",TE=/((?:WC+[\/:])*)/.source.replace("WC",Vm),bE=/(WCOD+)?/.source.replace("WCOD",EE),wE=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Vm),CE=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Vm),RE=new RegExp("^"+TE+bE+wE+CE+"$"),DE=["material","materials","bones","map"],Mm=class{constructor(e,n,i){let s=i||_t.parseTrackName(n);this._targetGroup=e,this._bindings=e.subscribe_(n,s)}getValue(e,n){this.bind();let i=this._targetGroup.nCachedObjects_,s=this._bindings[i];s!==void 0&&s.getValue(e,n)}setValue(e,n){let i=this._bindings;for(let s=this._targetGroup.nCachedObjects_,r=i.length;s!==r;++s)i[s].setValue(e,n)}bind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].bind()}unbind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].unbind()}},_t=class t{constructor(e,n,i){this.path=n,this.parsedPath=i||t.parseTrackName(n),this.node=t.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,n,i){return e&&e.isAnimationObjectGroup?new t.Composite(e,n,i):new t(e,n,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(ME,"")}static parseTrackName(e){let n=RE.exec(e);if(n===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let i={nodeName:n[2],objectName:n[3],objectIndex:n[4],propertyName:n[5],propertyIndex:n[6]},s=i.nodeName&&i.nodeName.lastIndexOf(".");if(s!==void 0&&s!==-1){let r=i.nodeName.substring(s+1);DE.indexOf(r)!==-1&&(i.nodeName=i.nodeName.substring(0,s),i.objectName=r)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,n){if(n===void 0||n===""||n==="."||n===-1||n===e.name||n===e.uuid)return e;if(e.skeleton){let i=e.skeleton.getBoneByName(n);if(i!==void 0)return i}if(e.children){let i=function(r){for(let a=0;a<r.length;a++){let o=r[a];if(o.name===n||o.uuid===n)return o;let l=i(o.children);if(l)return l}return null},s=i(e.children);if(s)return s}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,n){e[n]=this.targetObject[this.propertyName]}_getValue_array(e,n){let i=this.resolvedProperty;for(let s=0,r=i.length;s!==r;++s)e[n++]=i[s]}_getValue_arrayElement(e,n){e[n]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,n){this.resolvedProperty.toArray(e,n)}_setValue_direct(e,n){this.targetObject[this.propertyName]=e[n]}_setValue_direct_setNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,n){let i=this.resolvedProperty;for(let s=0,r=i.length;s!==r;++s)i[s]=e[n++]}_setValue_array_setNeedsUpdate(e,n){let i=this.resolvedProperty;for(let s=0,r=i.length;s!==r;++s)i[s]=e[n++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,n){let i=this.resolvedProperty;for(let s=0,r=i.length;s!==r;++s)i[s]=e[n++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,n){this.resolvedProperty[this.propertyIndex]=e[n]}_setValue_arrayElement_setNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,n){this.resolvedProperty.fromArray(e,n)}_setValue_fromArray_setNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,n){this.bind(),this.getValue(e,n)}_setValue_unbound(e,n){this.bind(),this.setValue(e,n)}bind(){let e=this.node,n=this.parsedPath,i=n.objectName,s=n.propertyName,r=n.propertyIndex;if(e||(e=t.findNode(this.rootNode,n.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let c=n.objectIndex;switch(i){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let f=0;f<e.length;f++)if(e[f].name===c){c=f;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(c!==void 0){if(e[c]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let a=e[s];if(a===void 0){let c=n.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+c+"."+s+" but it wasn't found.",e);return}let o=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?o=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(r!==void 0){if(s==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}l=this.BindingType.ArrayElement,this.resolvedProperty=a,this.propertyIndex=r}else a.fromArray!==void 0&&a.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=a):Array.isArray(a)?(l=this.BindingType.EntireArray,this.resolvedProperty=a):this.propertyName=s;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};_t.Composite=Mm;_t.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};_t.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};_t.prototype.GetterByBindingType=[_t.prototype._getValue_direct,_t.prototype._getValue_array,_t.prototype._getValue_arrayElement,_t.prototype._getValue_toArray];_t.prototype.SetterByBindingTypeAndVersioning=[[_t.prototype._setValue_direct,_t.prototype._setValue_direct_setNeedsUpdate,_t.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[_t.prototype._setValue_array,_t.prototype._setValue_array_setNeedsUpdate,_t.prototype._setValue_array_setMatrixWorldNeedsUpdate],[_t.prototype._setValue_arrayElement,_t.prototype._setValue_arrayElement_setNeedsUpdate,_t.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[_t.prototype._setValue_fromArray,_t.prototype._setValue_fromArray_setNeedsUpdate,_t.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var yR=new Float32Array(1);var vt=class t{constructor(e){this.value=e}clone(){return new t(this.value.clone===void 0?this.value:this.value.clone())}};function Wm(t,e,n,i){let s=UE(i);switch(n){case Lm:return t*e;case Om:return t*e/s.components*s.byteLength;case wf:return t*e/s.components*s.byteLength;case Fm:return t*e*2/s.components*s.byteLength;case Cf:return t*e*2/s.components*s.byteLength;case Nm:return t*e*3/s.components*s.byteLength;case ci:return t*e*4/s.components*s.byteLength;case Rf:return t*e*4/s.components*s.byteLength;case kl:case Vl:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case Wl:case Xl:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Uf:case If:return Math.max(t,16)*Math.max(e,8)/4;case Df:case Bf:return Math.max(t,8)*Math.max(e,8)/2;case Pf:case Lf:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case Nf:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Of:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Ff:return Math.floor((t+4)/5)*Math.floor((e+3)/4)*16;case zf:return Math.floor((t+4)/5)*Math.floor((e+4)/5)*16;case Hf:return Math.floor((t+5)/6)*Math.floor((e+4)/5)*16;case Gf:return Math.floor((t+5)/6)*Math.floor((e+5)/6)*16;case kf:return Math.floor((t+7)/8)*Math.floor((e+4)/5)*16;case Vf:return Math.floor((t+7)/8)*Math.floor((e+5)/6)*16;case Wf:return Math.floor((t+7)/8)*Math.floor((e+7)/8)*16;case Xf:return Math.floor((t+9)/10)*Math.floor((e+4)/5)*16;case Yf:return Math.floor((t+9)/10)*Math.floor((e+5)/6)*16;case qf:return Math.floor((t+9)/10)*Math.floor((e+7)/8)*16;case Qf:return Math.floor((t+9)/10)*Math.floor((e+9)/10)*16;case Zf:return Math.floor((t+11)/12)*Math.floor((e+9)/10)*16;case Kf:return Math.floor((t+11)/12)*Math.floor((e+11)/12)*16;case Jf:case jf:case $f:return Math.ceil(t/4)*Math.ceil(e/4)*16;case eh:case th:return Math.ceil(t/4)*Math.ceil(e/4)*8;case nh:case ih:return Math.ceil(t/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${n} format.`)}function UE(t){switch(t){case sn:case Um:return{byteLength:1,components:1};case ro:case Bm:case ao:return{byteLength:2,components:1};case Tf:case bf:return{byteLength:2,components:4};case $s:case Ef:case li:return{byteLength:4,components:1};case Im:case Pm:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${t}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"180"}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="180");function NA(){let t=null,e=!1,n=null,i=null;function s(r,a){n(r,a),i=t.requestAnimationFrame(s)}return{start:function(){e!==!0&&n!==null&&(i=t.requestAnimationFrame(s),e=!0)},stop:function(){t.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(r){n=r},setContext:function(r){t=r}}}function BE(t){let e=new WeakMap;function n(o,l){let c=o.array,f=o.usage,p=c.byteLength,h=t.createBuffer();t.bindBuffer(l,h),t.bufferData(l,c,f),o.onUploadCallback();let d;if(c instanceof Float32Array)d=t.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)d=t.HALF_FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?d=t.HALF_FLOAT:d=t.UNSIGNED_SHORT;else if(c instanceof Int16Array)d=t.SHORT;else if(c instanceof Uint32Array)d=t.UNSIGNED_INT;else if(c instanceof Int32Array)d=t.INT;else if(c instanceof Int8Array)d=t.BYTE;else if(c instanceof Uint8Array)d=t.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)d=t.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:h,type:d,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:p}}function i(o,l,c){let f=l.array,p=l.updateRanges;if(t.bindBuffer(c,o),p.length===0)t.bufferSubData(c,0,f);else{p.sort((d,y)=>d.start-y.start);let h=0;for(let d=1;d<p.length;d++){let y=p[h],_=p[d];_.start<=y.start+y.count+1?y.count=Math.max(y.count,_.start+_.count-y.start):(++h,p[h]=_)}p.length=h+1;for(let d=0,y=p.length;d<y;d++){let _=p[d];t.bufferSubData(c,_.start*f.BYTES_PER_ELEMENT,f,_.start,_.count)}l.clearUpdateRanges()}l.onUploadCallback()}function s(o){return o.isInterleavedBufferAttribute&&(o=o.data),e.get(o)}function r(o){o.isInterleavedBufferAttribute&&(o=o.data);let l=e.get(o);l&&(t.deleteBuffer(l.buffer),e.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){let f=e.get(o);(!f||f.version<o.version)&&e.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}let c=e.get(o);if(c===void 0)e.set(o,n(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(c.buffer,o,l),c.version=o.version}}return{get:s,remove:r,update:a}}var IE=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,PE=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,LE=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,NE=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,OE=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,FE=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,zE=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,HE=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,GE=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,kE=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,VE=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,WE=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,XE=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,YE=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,qE=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,QE=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,ZE=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,KE=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,JE=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,jE=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,$E=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,eT=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,tT=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,nT=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,iT=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,sT=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,rT=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,aT=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,oT=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,lT=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,cT="gl_FragColor = linearToOutputTexel( gl_FragColor );",uT=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,fT=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,hT=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,dT=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,pT=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,mT=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,gT=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,vT=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,xT=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,yT=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,_T=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,AT=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,ST=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,MT=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,ET=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,TT=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,bT=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,wT=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,CT=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,RT=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,DT=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,UT=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,BT=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,IT=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,PT=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,LT=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,NT=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,OT=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,FT=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,zT=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,HT=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,GT=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,kT=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,VT=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,WT=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,XT=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,YT=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,qT=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,QT=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,ZT=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,KT=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,JT=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,jT=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,$T=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,eb=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,tb=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,nb=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,ib=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,sb=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,rb=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,ab=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,ob=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,lb=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,cb=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,ub=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,fb=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,hb=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,db=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,pb=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		float depth = unpackRGBAToDepth( texture2D( depths, uv ) );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			return step( depth, compare );
		#else
			return step( compare, depth );
		#endif
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow( sampler2D shadow, vec2 uv, float compare ) {
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			float hard_shadow = step( distribution.x, compare );
		#else
			float hard_shadow = step( compare, distribution.x );
		#endif
		if ( hard_shadow != 1.0 ) {
			float distance = compare - distribution.x;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,mb=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,gb=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,vb=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,xb=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,yb=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,_b=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Ab=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Sb=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Mb=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Eb=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Tb=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,bb=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,wb=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,Cb=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Rb=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Db=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,Ub=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,Bb=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Ib=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Pb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Lb=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Nb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Ob=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Fb=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,zb=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,Hb=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,Gb=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,kb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Vb=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Wb=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Xb=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Yb=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,qb=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Qb=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Zb=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Kb=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,Jb=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,jb=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,$b=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,ew=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,tw=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,nw=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,iw=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,sw=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,rw=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,aw=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,ow=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,lw=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,cw=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,uw=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,fw=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,He={alphahash_fragment:IE,alphahash_pars_fragment:PE,alphamap_fragment:LE,alphamap_pars_fragment:NE,alphatest_fragment:OE,alphatest_pars_fragment:FE,aomap_fragment:zE,aomap_pars_fragment:HE,batching_pars_vertex:GE,batching_vertex:kE,begin_vertex:VE,beginnormal_vertex:WE,bsdfs:XE,iridescence_fragment:YE,bumpmap_pars_fragment:qE,clipping_planes_fragment:QE,clipping_planes_pars_fragment:ZE,clipping_planes_pars_vertex:KE,clipping_planes_vertex:JE,color_fragment:jE,color_pars_fragment:$E,color_pars_vertex:eT,color_vertex:tT,common:nT,cube_uv_reflection_fragment:iT,defaultnormal_vertex:sT,displacementmap_pars_vertex:rT,displacementmap_vertex:aT,emissivemap_fragment:oT,emissivemap_pars_fragment:lT,colorspace_fragment:cT,colorspace_pars_fragment:uT,envmap_fragment:fT,envmap_common_pars_fragment:hT,envmap_pars_fragment:dT,envmap_pars_vertex:pT,envmap_physical_pars_fragment:TT,envmap_vertex:mT,fog_vertex:gT,fog_pars_vertex:vT,fog_fragment:xT,fog_pars_fragment:yT,gradientmap_pars_fragment:_T,lightmap_pars_fragment:AT,lights_lambert_fragment:ST,lights_lambert_pars_fragment:MT,lights_pars_begin:ET,lights_toon_fragment:bT,lights_toon_pars_fragment:wT,lights_phong_fragment:CT,lights_phong_pars_fragment:RT,lights_physical_fragment:DT,lights_physical_pars_fragment:UT,lights_fragment_begin:BT,lights_fragment_maps:IT,lights_fragment_end:PT,logdepthbuf_fragment:LT,logdepthbuf_pars_fragment:NT,logdepthbuf_pars_vertex:OT,logdepthbuf_vertex:FT,map_fragment:zT,map_pars_fragment:HT,map_particle_fragment:GT,map_particle_pars_fragment:kT,metalnessmap_fragment:VT,metalnessmap_pars_fragment:WT,morphinstance_vertex:XT,morphcolor_vertex:YT,morphnormal_vertex:qT,morphtarget_pars_vertex:QT,morphtarget_vertex:ZT,normal_fragment_begin:KT,normal_fragment_maps:JT,normal_pars_fragment:jT,normal_pars_vertex:$T,normal_vertex:eb,normalmap_pars_fragment:tb,clearcoat_normal_fragment_begin:nb,clearcoat_normal_fragment_maps:ib,clearcoat_pars_fragment:sb,iridescence_pars_fragment:rb,opaque_fragment:ab,packing:ob,premultiplied_alpha_fragment:lb,project_vertex:cb,dithering_fragment:ub,dithering_pars_fragment:fb,roughnessmap_fragment:hb,roughnessmap_pars_fragment:db,shadowmap_pars_fragment:pb,shadowmap_pars_vertex:mb,shadowmap_vertex:gb,shadowmask_pars_fragment:vb,skinbase_vertex:xb,skinning_pars_vertex:yb,skinning_vertex:_b,skinnormal_vertex:Ab,specularmap_fragment:Sb,specularmap_pars_fragment:Mb,tonemapping_fragment:Eb,tonemapping_pars_fragment:Tb,transmission_fragment:bb,transmission_pars_fragment:wb,uv_pars_fragment:Cb,uv_pars_vertex:Rb,uv_vertex:Db,worldpos_vertex:Ub,background_vert:Bb,background_frag:Ib,backgroundCube_vert:Pb,backgroundCube_frag:Lb,cube_vert:Nb,cube_frag:Ob,depth_vert:Fb,depth_frag:zb,distanceRGBA_vert:Hb,distanceRGBA_frag:Gb,equirect_vert:kb,equirect_frag:Vb,linedashed_vert:Wb,linedashed_frag:Xb,meshbasic_vert:Yb,meshbasic_frag:qb,meshlambert_vert:Qb,meshlambert_frag:Zb,meshmatcap_vert:Kb,meshmatcap_frag:Jb,meshnormal_vert:jb,meshnormal_frag:$b,meshphong_vert:ew,meshphong_frag:tw,meshphysical_vert:nw,meshphysical_frag:iw,meshtoon_vert:sw,meshtoon_frag:rw,points_vert:aw,points_frag:ow,shadow_vert:lw,shadow_frag:cw,sprite_vert:uw,sprite_frag:fw},ce={common:{diffuse:{value:new qe(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Ne},alphaMap:{value:null},alphaMapTransform:{value:new Ne},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Ne}},envmap:{envMap:{value:null},envMapRotation:{value:new Ne},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Ne}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Ne}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Ne},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Ne},normalScale:{value:new Le(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Ne},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Ne}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Ne}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Ne}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new qe(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new qe(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Ne},alphaTest:{value:0},uvTransform:{value:new Ne}},sprite:{diffuse:{value:new qe(16777215)},opacity:{value:1},center:{value:new Le(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Ne},alphaMap:{value:null},alphaMapTransform:{value:new Ne},alphaTest:{value:0}}},Oi={basic:{uniforms:gn([ce.common,ce.specularmap,ce.envmap,ce.aomap,ce.lightmap,ce.fog]),vertexShader:He.meshbasic_vert,fragmentShader:He.meshbasic_frag},lambert:{uniforms:gn([ce.common,ce.specularmap,ce.envmap,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.fog,ce.lights,{emissive:{value:new qe(0)}}]),vertexShader:He.meshlambert_vert,fragmentShader:He.meshlambert_frag},phong:{uniforms:gn([ce.common,ce.specularmap,ce.envmap,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.fog,ce.lights,{emissive:{value:new qe(0)},specular:{value:new qe(1118481)},shininess:{value:30}}]),vertexShader:He.meshphong_vert,fragmentShader:He.meshphong_frag},standard:{uniforms:gn([ce.common,ce.envmap,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.roughnessmap,ce.metalnessmap,ce.fog,ce.lights,{emissive:{value:new qe(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:He.meshphysical_vert,fragmentShader:He.meshphysical_frag},toon:{uniforms:gn([ce.common,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.gradientmap,ce.fog,ce.lights,{emissive:{value:new qe(0)}}]),vertexShader:He.meshtoon_vert,fragmentShader:He.meshtoon_frag},matcap:{uniforms:gn([ce.common,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.fog,{matcap:{value:null}}]),vertexShader:He.meshmatcap_vert,fragmentShader:He.meshmatcap_frag},points:{uniforms:gn([ce.points,ce.fog]),vertexShader:He.points_vert,fragmentShader:He.points_frag},dashed:{uniforms:gn([ce.common,ce.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:He.linedashed_vert,fragmentShader:He.linedashed_frag},depth:{uniforms:gn([ce.common,ce.displacementmap]),vertexShader:He.depth_vert,fragmentShader:He.depth_frag},normal:{uniforms:gn([ce.common,ce.bumpmap,ce.normalmap,ce.displacementmap,{opacity:{value:1}}]),vertexShader:He.meshnormal_vert,fragmentShader:He.meshnormal_frag},sprite:{uniforms:gn([ce.sprite,ce.fog]),vertexShader:He.sprite_vert,fragmentShader:He.sprite_frag},background:{uniforms:{uvTransform:{value:new Ne},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:He.background_vert,fragmentShader:He.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Ne}},vertexShader:He.backgroundCube_vert,fragmentShader:He.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:He.cube_vert,fragmentShader:He.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:He.equirect_vert,fragmentShader:He.equirect_frag},distanceRGBA:{uniforms:gn([ce.common,ce.displacementmap,{referencePosition:{value:new z},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:He.distanceRGBA_vert,fragmentShader:He.distanceRGBA_frag},shadow:{uniforms:gn([ce.lights,ce.fog,{color:{value:new qe(0)},opacity:{value:1}}]),vertexShader:He.shadow_vert,fragmentShader:He.shadow_frag}};Oi.physical={uniforms:gn([Oi.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Ne},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Ne},clearcoatNormalScale:{value:new Le(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Ne},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Ne},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Ne},sheen:{value:0},sheenColor:{value:new qe(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Ne},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Ne},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Ne},transmissionSamplerSize:{value:new Le},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Ne},attenuationDistance:{value:0},attenuationColor:{value:new qe(0)},specularColor:{value:new qe(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Ne},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Ne},anisotropyVector:{value:new Le},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Ne}}]),vertexShader:He.meshphysical_vert,fragmentShader:He.meshphysical_frag};var sh={r:0,b:0,g:0},zr=new Ii,hw=new Xt;function dw(t,e,n,i,s,r,a){let o=new qe(0),l=r===!0?0:1,c,f,p=null,h=0,d=null;function y(v){let x=v.isScene===!0?v.background:null;return x&&x.isTexture&&(x=(v.backgroundBlurriness>0?n:e).get(x)),x}function _(v){let x=!1,T=y(v);T===null?u(o,l):T&&T.isColor&&(u(T,1),x=!0);let C=t.xr.getEnvironmentBlendMode();C==="additive"?i.buffers.color.setClear(0,0,0,1,a):C==="alpha-blend"&&i.buffers.color.setClear(0,0,0,0,a),(t.autoClear||x)&&(i.buffers.depth.setTest(!0),i.buffers.depth.setMask(!0),i.buffers.color.setMask(!0),t.clear(t.autoClearColor,t.autoClearDepth,t.autoClearStencil))}function m(v,x){let T=y(x);T&&(T.isCubeTexture||T.mapping===Hl)?(f===void 0&&(f=new mn(new no(1,1,1),new Qt({name:"BackgroundCubeMaterial",uniforms:Fr(Oi.backgroundCube.uniforms),vertexShader:Oi.backgroundCube.vertexShader,fragmentShader:Oi.backgroundCube.fragmentShader,side:Gt,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),f.geometry.deleteAttribute("normal"),f.geometry.deleteAttribute("uv"),f.onBeforeRender=function(C,w,D){this.matrixWorld.copyPosition(D.matrixWorld)},Object.defineProperty(f.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(f)),zr.copy(x.backgroundRotation),zr.x*=-1,zr.y*=-1,zr.z*=-1,T.isCubeTexture&&T.isRenderTargetTexture===!1&&(zr.y*=-1,zr.z*=-1),f.material.uniforms.envMap.value=T,f.material.uniforms.flipEnvMap.value=T.isCubeTexture&&T.isRenderTargetTexture===!1?-1:1,f.material.uniforms.backgroundBlurriness.value=x.backgroundBlurriness,f.material.uniforms.backgroundIntensity.value=x.backgroundIntensity,f.material.uniforms.backgroundRotation.value.setFromMatrix4(hw.makeRotationFromEuler(zr)),f.material.toneMapped=je.getTransfer(T.colorSpace)!==lt,(p!==T||h!==T.version||d!==t.toneMapping)&&(f.material.needsUpdate=!0,p=T,h=T.version,d=t.toneMapping),f.layers.enableAll(),v.unshift(f,f.geometry,f.material,0,0,null)):T&&T.isTexture&&(c===void 0&&(c=new mn(new Pr(2,2),new Qt({name:"BackgroundMaterial",uniforms:Fr(Oi.background.uniforms),vertexShader:Oi.background.vertexShader,fragmentShader:Oi.background.fragmentShader,side:vi,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(c)),c.material.uniforms.t2D.value=T,c.material.uniforms.backgroundIntensity.value=x.backgroundIntensity,c.material.toneMapped=je.getTransfer(T.colorSpace)!==lt,T.matrixAutoUpdate===!0&&T.updateMatrix(),c.material.uniforms.uvTransform.value.copy(T.matrix),(p!==T||h!==T.version||d!==t.toneMapping)&&(c.material.needsUpdate=!0,p=T,h=T.version,d=t.toneMapping),c.layers.enableAll(),v.unshift(c,c.geometry,c.material,0,0,null))}function u(v,x){v.getRGB(sh,Gm(t)),i.buffers.color.setClear(sh.r,sh.g,sh.b,x,a)}function g(){f!==void 0&&(f.geometry.dispose(),f.material.dispose(),f=void 0),c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0)}return{getClearColor:function(){return o},setClearColor:function(v,x=1){o.set(v),l=x,u(o,l)},getClearAlpha:function(){return l},setClearAlpha:function(v){l=v,u(o,l)},render:_,addToRenderList:m,dispose:g}}function pw(t,e){let n=t.getParameter(t.MAX_VERTEX_ATTRIBS),i={},s=h(null),r=s,a=!1;function o(M,U,G,V,Y){let O=!1,N=p(V,G,U);r!==N&&(r=N,c(r.object)),O=d(M,V,G,Y),O&&y(M,V,G,Y),Y!==null&&e.update(Y,t.ELEMENT_ARRAY_BUFFER),(O||a)&&(a=!1,x(M,U,G,V),Y!==null&&t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,e.get(Y).buffer))}function l(){return t.createVertexArray()}function c(M){return t.bindVertexArray(M)}function f(M){return t.deleteVertexArray(M)}function p(M,U,G){let V=G.wireframe===!0,Y=i[M.id];Y===void 0&&(Y={},i[M.id]=Y);let O=Y[U.id];O===void 0&&(O={},Y[U.id]=O);let N=O[V];return N===void 0&&(N=h(l()),O[V]=N),N}function h(M){let U=[],G=[],V=[];for(let Y=0;Y<n;Y++)U[Y]=0,G[Y]=0,V[Y]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:U,enabledAttributes:G,attributeDivisors:V,object:M,attributes:{},index:null}}function d(M,U,G,V){let Y=r.attributes,O=U.attributes,N=0,J=G.getAttributes();for(let k in J)if(J[k].location>=0){let pe=Y[k],Me=O[k];if(Me===void 0&&(k==="instanceMatrix"&&M.instanceMatrix&&(Me=M.instanceMatrix),k==="instanceColor"&&M.instanceColor&&(Me=M.instanceColor)),pe===void 0||pe.attribute!==Me||Me&&pe.data!==Me.data)return!0;N++}return r.attributesNum!==N||r.index!==V}function y(M,U,G,V){let Y={},O=U.attributes,N=0,J=G.getAttributes();for(let k in J)if(J[k].location>=0){let pe=O[k];pe===void 0&&(k==="instanceMatrix"&&M.instanceMatrix&&(pe=M.instanceMatrix),k==="instanceColor"&&M.instanceColor&&(pe=M.instanceColor));let Me={};Me.attribute=pe,pe&&pe.data&&(Me.data=pe.data),Y[k]=Me,N++}r.attributes=Y,r.attributesNum=N,r.index=V}function _(){let M=r.newAttributes;for(let U=0,G=M.length;U<G;U++)M[U]=0}function m(M){u(M,0)}function u(M,U){let G=r.newAttributes,V=r.enabledAttributes,Y=r.attributeDivisors;G[M]=1,V[M]===0&&(t.enableVertexAttribArray(M),V[M]=1),Y[M]!==U&&(t.vertexAttribDivisor(M,U),Y[M]=U)}function g(){let M=r.newAttributes,U=r.enabledAttributes;for(let G=0,V=U.length;G<V;G++)U[G]!==M[G]&&(t.disableVertexAttribArray(G),U[G]=0)}function v(M,U,G,V,Y,O,N){N===!0?t.vertexAttribIPointer(M,U,G,Y,O):t.vertexAttribPointer(M,U,G,V,Y,O)}function x(M,U,G,V){_();let Y=V.attributes,O=G.getAttributes(),N=U.defaultAttributeValues;for(let J in O){let k=O[J];if(k.location>=0){let se=Y[J];if(se===void 0&&(J==="instanceMatrix"&&M.instanceMatrix&&(se=M.instanceMatrix),J==="instanceColor"&&M.instanceColor&&(se=M.instanceColor)),se!==void 0){let pe=se.normalized,Me=se.itemSize,Fe=e.get(se);if(Fe===void 0)continue;let rt=Fe.buffer,ht=Fe.type,Je=Fe.bytesPerElement,q=ht===t.INT||ht===t.UNSIGNED_INT||se.gpuType===Ef;if(se.isInterleavedBufferAttribute){let K=se.data,oe=K.stride,Te=se.offset;if(K.isInstancedInterleavedBuffer){for(let ve=0;ve<k.locationSize;ve++)u(k.location+ve,K.meshPerAttribute);M.isInstancedMesh!==!0&&V._maxInstanceCount===void 0&&(V._maxInstanceCount=K.meshPerAttribute*K.count)}else for(let ve=0;ve<k.locationSize;ve++)m(k.location+ve);t.bindBuffer(t.ARRAY_BUFFER,rt);for(let ve=0;ve<k.locationSize;ve++)v(k.location+ve,Me/k.locationSize,ht,pe,oe*Je,(Te+Me/k.locationSize*ve)*Je,q)}else{if(se.isInstancedBufferAttribute){for(let K=0;K<k.locationSize;K++)u(k.location+K,se.meshPerAttribute);M.isInstancedMesh!==!0&&V._maxInstanceCount===void 0&&(V._maxInstanceCount=se.meshPerAttribute*se.count)}else for(let K=0;K<k.locationSize;K++)m(k.location+K);t.bindBuffer(t.ARRAY_BUFFER,rt);for(let K=0;K<k.locationSize;K++)v(k.location+K,Me/k.locationSize,ht,pe,Me*Je,Me/k.locationSize*K*Je,q)}}else if(N!==void 0){let pe=N[J];if(pe!==void 0)switch(pe.length){case 2:t.vertexAttrib2fv(k.location,pe);break;case 3:t.vertexAttrib3fv(k.location,pe);break;case 4:t.vertexAttrib4fv(k.location,pe);break;default:t.vertexAttrib1fv(k.location,pe)}}}}g()}function T(){D();for(let M in i){let U=i[M];for(let G in U){let V=U[G];for(let Y in V)f(V[Y].object),delete V[Y];delete U[G]}delete i[M]}}function C(M){if(i[M.id]===void 0)return;let U=i[M.id];for(let G in U){let V=U[G];for(let Y in V)f(V[Y].object),delete V[Y];delete U[G]}delete i[M.id]}function w(M){for(let U in i){let G=i[U];if(G[M.id]===void 0)continue;let V=G[M.id];for(let Y in V)f(V[Y].object),delete V[Y];delete G[M.id]}}function D(){E(),a=!0,r!==s&&(r=s,c(r.object))}function E(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:o,reset:D,resetDefaultState:E,dispose:T,releaseStatesOfGeometry:C,releaseStatesOfProgram:w,initAttributes:_,enableAttribute:m,disableUnusedAttributes:g}}function mw(t,e,n){let i;function s(c){i=c}function r(c,f){t.drawArrays(i,c,f),n.update(f,i,1)}function a(c,f,p){p!==0&&(t.drawArraysInstanced(i,c,f,p),n.update(f,i,p))}function o(c,f,p){if(p===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,c,0,f,0,p);let d=0;for(let y=0;y<p;y++)d+=f[y];n.update(d,i,1)}function l(c,f,p,h){if(p===0)return;let d=e.get("WEBGL_multi_draw");if(d===null)for(let y=0;y<c.length;y++)a(c[y],f[y],h[y]);else{d.multiDrawArraysInstancedWEBGL(i,c,0,f,0,h,0,p);let y=0;for(let _=0;_<p;_++)y+=f[_]*h[_];n.update(y,i,1)}}this.setMode=s,this.render=r,this.renderInstances=a,this.renderMultiDraw=o,this.renderMultiDrawInstances=l}function gw(t,e,n,i){let s;function r(){if(s!==void 0)return s;if(e.has("EXT_texture_filter_anisotropic")===!0){let w=e.get("EXT_texture_filter_anisotropic");s=t.getParameter(w.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function a(w){return!(w!==ci&&i.convert(w)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(w){let D=w===ao&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(w!==sn&&i.convert(w)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_TYPE)&&w!==li&&!D)}function l(w){if(w==="highp"){if(t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.HIGH_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.HIGH_FLOAT).precision>0)return"highp";w="mediump"}return w==="mediump"&&t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.MEDIUM_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=n.precision!==void 0?n.precision:"highp",f=l(c);f!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",f,"instead."),c=f);let p=n.logarithmicDepthBuffer===!0,h=n.reversedDepthBuffer===!0&&e.has("EXT_clip_control"),d=t.getParameter(t.MAX_TEXTURE_IMAGE_UNITS),y=t.getParameter(t.MAX_VERTEX_TEXTURE_IMAGE_UNITS),_=t.getParameter(t.MAX_TEXTURE_SIZE),m=t.getParameter(t.MAX_CUBE_MAP_TEXTURE_SIZE),u=t.getParameter(t.MAX_VERTEX_ATTRIBS),g=t.getParameter(t.MAX_VERTEX_UNIFORM_VECTORS),v=t.getParameter(t.MAX_VARYING_VECTORS),x=t.getParameter(t.MAX_FRAGMENT_UNIFORM_VECTORS),T=y>0,C=t.getParameter(t.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:p,reversedDepthBuffer:h,maxTextures:d,maxVertexTextures:y,maxTextureSize:_,maxCubemapSize:m,maxAttributes:u,maxVertexUniforms:g,maxVaryings:v,maxFragmentUniforms:x,vertexTextures:T,maxSamples:C}}function vw(t){let e=this,n=null,i=0,s=!1,r=!1,a=new Ui,o=new Ne,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(p,h){let d=p.length!==0||h||i!==0||s;return s=h,i=p.length,d},this.beginShadows=function(){r=!0,f(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(p,h){n=f(p,h,0)},this.setState=function(p,h,d){let y=p.clippingPlanes,_=p.clipIntersection,m=p.clipShadows,u=t.get(p);if(!s||y===null||y.length===0||r&&!m)r?f(null):c();else{let g=r?0:i,v=g*4,x=u.clippingState||null;l.value=x,x=f(y,h,v,d);for(let T=0;T!==v;++T)x[T]=n[T];u.clippingState=x,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=g}};function c(){l.value!==n&&(l.value=n,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function f(p,h,d,y){let _=p!==null?p.length:0,m=null;if(_!==0){if(m=l.value,y!==!0||m===null){let u=d+_*4,g=h.matrixWorldInverse;o.getNormalMatrix(g),(m===null||m.length<u)&&(m=new Float32Array(u));for(let v=0,x=d;v!==_;++v,x+=4)a.copy(p[v]).applyMatrix4(g,o),a.normal.toArray(m,x),m[x+3]=a.constant}l.value=m,l.needsUpdate=!0}return e.numPlanes=_,e.numIntersection=0,m}}function xw(t){let e=new WeakMap;function n(a,o){return o===Af?a.mapping=Nr:o===Sf&&(a.mapping=Or),a}function i(a){if(a&&a.isTexture){let o=a.mapping;if(o===Af||o===Sf)if(e.has(a)){let l=e.get(a).texture;return n(l,a.mapping)}else{let l=a.image;if(l&&l.height>0){let c=new tf(l.height);return c.fromEquirectangularTexture(t,a),e.set(a,c),a.addEventListener("dispose",s),n(c.texture,a.mapping)}else return null}}return a}function s(a){let o=a.target;o.removeEventListener("dispose",s);let l=e.get(o);l!==void 0&&(e.delete(o),l.dispose())}function r(){e=new WeakMap}return{get:i,dispose:r}}var lo=4,dA=[.125,.215,.35,.446,.526,.582],kr=20,Xm=new Js,pA=new qe,Ym=null,qm=0,Qm=0,Zm=!1,Gr=(1+Math.sqrt(5))/2,oo=1/Gr,mA=[new z(-Gr,oo,0),new z(Gr,oo,0),new z(-oo,0,Gr),new z(oo,0,Gr),new z(0,Gr,-oo),new z(0,Gr,oo),new z(-1,1,-1),new z(1,1,-1),new z(-1,1,1),new z(1,1,1)],yw=new z,oh=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,n=0,i=.1,s=100,r={}){let{size:a=256,position:o=yw}=r;Ym=this._renderer.getRenderTarget(),qm=this._renderer.getActiveCubeFace(),Qm=this._renderer.getActiveMipmapLevel(),Zm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,i,s,l,o),n>0&&this._blur(l,0,0,n),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,n=null){return this._fromTexture(e,n)}fromCubemap(e,n=null){return this._fromTexture(e,n)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=xA(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=vA(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(Ym,qm,Qm),this._renderer.xr.enabled=Zm,e.scissorTest=!1,rh(e,0,0,e.width,e.height)}_fromTexture(e,n){e.mapping===Nr||e.mapping===Or?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Ym=this._renderer.getRenderTarget(),qm=this._renderer.getActiveCubeFace(),Qm=this._renderer.getActiveMipmapLevel(),Zm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=n||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),n=4*this._cubeSize,i={magFilter:Ht,minFilter:Ht,generateMipmaps:!1,type:ao,format:ci,colorSpace:xi,depthBuffer:!1},s=gA(e,n,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==n){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=gA(e,n,i);let{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=_w(r)),this._blurMaterial=Aw(r,e,n)}return s}_compileMaterial(e){let n=new mn(this._lodPlanes[0],e);this._renderer.compile(n,Xm)}_sceneToCubeUV(e,n,i,s,r){let l=new dn(90,1,n,i),c=[1,-1,1,1,1,1],f=[1,1,1,-1,-1,-1],p=this._renderer,h=p.autoClear,d=p.toneMapping;p.getClearColor(pA),p.toneMapping=us,p.autoClear=!1,p.state.buffers.depth.getReversed()&&(p.setRenderTarget(s),p.clearDepth(),p.setRenderTarget(null));let _=new Ul({name:"PMREM.Background",side:Gt,depthWrite:!1,depthTest:!1}),m=new mn(new no,_),u=!1,g=e.background;g?g.isColor&&(_.color.copy(g),e.background=null,u=!0):(_.color.copy(pA),u=!0);for(let v=0;v<6;v++){let x=v%3;x===0?(l.up.set(0,c[v],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x+f[v],r.y,r.z)):x===1?(l.up.set(0,0,c[v]),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y+f[v],r.z)):(l.up.set(0,c[v],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y,r.z+f[v]));let T=this._cubeSize;rh(s,x*T,v>2?T:0,T,T),p.setRenderTarget(s),u&&p.render(m,l),p.render(e,l)}m.geometry.dispose(),m.material.dispose(),p.toneMapping=d,p.autoClear=h,e.background=g}_textureToCubeUV(e,n){let i=this._renderer,s=e.mapping===Nr||e.mapping===Or;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=xA()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=vA());let r=s?this._cubemapMaterial:this._equirectMaterial,a=new mn(this._lodPlanes[0],r),o=r.uniforms;o.envMap.value=e;let l=this._cubeSize;rh(n,0,0,3*l,2*l),i.setRenderTarget(n),i.render(a,Xm)}_applyPMREM(e){let n=this._renderer,i=n.autoClear;n.autoClear=!1;let s=this._lodPlanes.length;for(let r=1;r<s;r++){let a=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),o=mA[(s-r-1)%mA.length];this._blur(e,r-1,r,a,o)}n.autoClear=i}_blur(e,n,i,s,r){let a=this._pingPongRenderTarget;this._halfBlur(e,a,n,i,s,"latitudinal",r),this._halfBlur(a,e,i,i,s,"longitudinal",r)}_halfBlur(e,n,i,s,r,a,o){let l=this._renderer,c=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");let f=3,p=new mn(this._lodPlanes[s],c),h=c.uniforms,d=this._sizeLods[i]-1,y=isFinite(r)?Math.PI/(2*d):2*Math.PI/(2*kr-1),_=r/y,m=isFinite(r)?1+Math.floor(f*_):kr;m>kr&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${kr}`);let u=[],g=0;for(let w=0;w<kr;++w){let D=w/_,E=Math.exp(-D*D/2);u.push(E),w===0?g+=E:w<m&&(g+=2*E)}for(let w=0;w<u.length;w++)u[w]=u[w]/g;h.envMap.value=e.texture,h.samples.value=m,h.weights.value=u,h.latitudinal.value=a==="latitudinal",o&&(h.poleAxis.value=o);let{_lodMax:v}=this;h.dTheta.value=y,h.mipInt.value=v-i;let x=this._sizeLods[s],T=3*x*(s>v-lo?s-v+lo:0),C=4*(this._cubeSize-x);rh(n,T,C,3*x,2*x),l.setRenderTarget(n),l.render(p,Xm)}};function _w(t){let e=[],n=[],i=[],s=t,r=t-lo+1+dA.length;for(let a=0;a<r;a++){let o=Math.pow(2,s);n.push(o);let l=1/o;a>t-lo?l=dA[a-t+lo-1]:a===0&&(l=0),i.push(l);let c=1/(o-2),f=-c,p=1+c,h=[f,f,p,f,p,p,f,f,p,p,f,p],d=6,y=6,_=3,m=2,u=1,g=new Float32Array(_*y*d),v=new Float32Array(m*y*d),x=new Float32Array(u*y*d);for(let C=0;C<d;C++){let w=C%3*2/3-1,D=C>2?0:-1,E=[w,D,0,w+2/3,D,0,w+2/3,D+1,0,w,D,0,w+2/3,D+1,0,w,D+1,0];g.set(E,_*y*C),v.set(h,m*y*C);let M=[C,C,C,C,C,C];x.set(M,u*y*C)}let T=new Pi;T.setAttribute("position",new pn(g,_)),T.setAttribute("uv",new pn(v,m)),T.setAttribute("faceIndex",new pn(x,u)),e.push(T),s>lo&&s--}return{lodPlanes:e,sizeLods:n,sigmas:i}}function gA(t,e,n){let i=new qt(t,e,n);return i.texture.mapping=Hl,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function rh(t,e,n,i,s){t.viewport.set(e,n,i,s),t.scissor.set(e,n,i,s)}function Aw(t,e,n){let i=new Float32Array(kr),s=new z(0,1,0);return new Qt({name:"SphericalGaussianBlur",defines:{n:kr,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:rg(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Xn,depthTest:!1,depthWrite:!1})}function vA(){return new Qt({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:rg(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Xn,depthTest:!1,depthWrite:!1})}function xA(){return new Qt({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:rg(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Xn,depthTest:!1,depthWrite:!1})}function rg(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Sw(t){let e=new WeakMap,n=null;function i(o){if(o&&o.isTexture){let l=o.mapping,c=l===Af||l===Sf,f=l===Nr||l===Or;if(c||f){let p=e.get(o),h=p!==void 0?p.texture.pmremVersion:0;if(o.isRenderTargetTexture&&o.pmremVersion!==h)return n===null&&(n=new oh(t)),p=c?n.fromEquirectangular(o,p):n.fromCubemap(o,p),p.texture.pmremVersion=o.pmremVersion,e.set(o,p),p.texture;if(p!==void 0)return p.texture;{let d=o.image;return c&&d&&d.height>0||f&&d&&s(d)?(n===null&&(n=new oh(t)),p=c?n.fromEquirectangular(o):n.fromCubemap(o),p.texture.pmremVersion=o.pmremVersion,e.set(o,p),o.addEventListener("dispose",r),p.texture):null}}}return o}function s(o){let l=0,c=6;for(let f=0;f<c;f++)o[f]!==void 0&&l++;return l===c}function r(o){let l=o.target;l.removeEventListener("dispose",r);let c=e.get(l);c!==void 0&&(e.delete(l),c.dispose())}function a(){e=new WeakMap,n!==null&&(n.dispose(),n=null)}return{get:i,dispose:a}}function Mw(t){let e={};function n(i){if(e[i]!==void 0)return e[i];let s;switch(i){case"WEBGL_depth_texture":s=t.getExtension("WEBGL_depth_texture")||t.getExtension("MOZ_WEBGL_depth_texture")||t.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=t.getExtension("EXT_texture_filter_anisotropic")||t.getExtension("MOZ_EXT_texture_filter_anisotropic")||t.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=t.getExtension("WEBGL_compressed_texture_s3tc")||t.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||t.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=t.getExtension("WEBGL_compressed_texture_pvrtc")||t.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=t.getExtension(i)}return e[i]=s,s}return{has:function(i){return n(i)!==null},init:function(){n("EXT_color_buffer_float"),n("WEBGL_clip_cull_distance"),n("OES_texture_float_linear"),n("EXT_color_buffer_half_float"),n("WEBGL_multisampled_render_to_texture"),n("WEBGL_render_shared_exponent")},get:function(i){let s=n(i);return s===null&&$a("THREE.WebGLRenderer: "+i+" extension not supported."),s}}}function Ew(t,e,n,i){let s={},r=new WeakMap;function a(p){let h=p.target;h.index!==null&&e.remove(h.index);for(let y in h.attributes)e.remove(h.attributes[y]);h.removeEventListener("dispose",a),delete s[h.id];let d=r.get(h);d&&(e.remove(d),r.delete(h)),i.releaseStatesOfGeometry(h),h.isInstancedBufferGeometry===!0&&delete h._maxInstanceCount,n.memory.geometries--}function o(p,h){return s[h.id]===!0||(h.addEventListener("dispose",a),s[h.id]=!0,n.memory.geometries++),h}function l(p){let h=p.attributes;for(let d in h)e.update(h[d],t.ARRAY_BUFFER)}function c(p){let h=[],d=p.index,y=p.attributes.position,_=0;if(d!==null){let g=d.array;_=d.version;for(let v=0,x=g.length;v<x;v+=3){let T=g[v+0],C=g[v+1],w=g[v+2];h.push(T,C,C,w,w,T)}}else if(y!==void 0){let g=y.array;_=y.version;for(let v=0,x=g.length/3-1;v<x;v+=3){let T=v+0,C=v+1,w=v+2;h.push(T,C,C,w,w,T)}}else return;let m=new(Hm(h)?Il:Bl)(h,1);m.version=_;let u=r.get(p);u&&e.remove(u),r.set(p,m)}function f(p){let h=r.get(p);if(h){let d=p.index;d!==null&&h.version<d.version&&c(p)}else c(p);return r.get(p)}return{get:o,update:l,getWireframeAttribute:f}}function Tw(t,e,n){let i;function s(h){i=h}let r,a;function o(h){r=h.type,a=h.bytesPerElement}function l(h,d){t.drawElements(i,d,r,h*a),n.update(d,i,1)}function c(h,d,y){y!==0&&(t.drawElementsInstanced(i,d,r,h*a,y),n.update(d,i,y))}function f(h,d,y){if(y===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,d,0,r,h,0,y);let m=0;for(let u=0;u<y;u++)m+=d[u];n.update(m,i,1)}function p(h,d,y,_){if(y===0)return;let m=e.get("WEBGL_multi_draw");if(m===null)for(let u=0;u<h.length;u++)c(h[u]/a,d[u],_[u]);else{m.multiDrawElementsInstancedWEBGL(i,d,0,r,h,0,_,0,y);let u=0;for(let g=0;g<y;g++)u+=d[g]*_[g];n.update(u,i,1)}}this.setMode=s,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=f,this.renderMultiDrawInstances=p}function bw(t){let e={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function i(r,a,o){switch(n.calls++,a){case t.TRIANGLES:n.triangles+=o*(r/3);break;case t.LINES:n.lines+=o*(r/2);break;case t.LINE_STRIP:n.lines+=o*(r-1);break;case t.LINE_LOOP:n.lines+=o*r;break;case t.POINTS:n.points+=o*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",a);break}}function s(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:e,render:n,programs:null,autoReset:!0,reset:s,update:i}}function ww(t,e,n){let i=new WeakMap,s=new Bt;function r(a,o,l){let c=a.morphTargetInfluences,f=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,p=f!==void 0?f.length:0,h=i.get(o);if(h===void 0||h.count!==p){let E=function(){w.dispose(),i.delete(o),o.removeEventListener("dispose",E)};h!==void 0&&h.texture.dispose();let d=o.morphAttributes.position!==void 0,y=o.morphAttributes.normal!==void 0,_=o.morphAttributes.color!==void 0,m=o.morphAttributes.position||[],u=o.morphAttributes.normal||[],g=o.morphAttributes.color||[],v=0;d===!0&&(v=1),y===!0&&(v=2),_===!0&&(v=3);let x=o.attributes.position.count*v,T=1;x>e.maxTextureSize&&(T=Math.ceil(x/e.maxTextureSize),x=e.maxTextureSize);let C=new Float32Array(x*T*4*p),w=new Rl(C,x,T,p);w.type=li,w.needsUpdate=!0;let D=v*4;for(let M=0;M<p;M++){let U=m[M],G=u[M],V=g[M],Y=x*T*4*M;for(let O=0;O<U.count;O++){let N=O*D;d===!0&&(s.fromBufferAttribute(U,O),C[Y+N+0]=s.x,C[Y+N+1]=s.y,C[Y+N+2]=s.z,C[Y+N+3]=0),y===!0&&(s.fromBufferAttribute(G,O),C[Y+N+4]=s.x,C[Y+N+5]=s.y,C[Y+N+6]=s.z,C[Y+N+7]=0),_===!0&&(s.fromBufferAttribute(V,O),C[Y+N+8]=s.x,C[Y+N+9]=s.y,C[Y+N+10]=s.z,C[Y+N+11]=V.itemSize===4?s.w:1)}}h={count:p,texture:w,size:new Le(x,T)},i.set(o,h),o.addEventListener("dispose",E)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(t,"morphTexture",a.morphTexture,n);else{let d=0;for(let _=0;_<c.length;_++)d+=c[_];let y=o.morphTargetsRelative?1:1-d;l.getUniforms().setValue(t,"morphTargetBaseInfluence",y),l.getUniforms().setValue(t,"morphTargetInfluences",c)}l.getUniforms().setValue(t,"morphTargetsTexture",h.texture,n),l.getUniforms().setValue(t,"morphTargetsTextureSize",h.size)}return{update:r}}function Cw(t,e,n,i){let s=new WeakMap;function r(l){let c=i.render.frame,f=l.geometry,p=e.get(l,f);if(s.get(p)!==c&&(e.update(p),s.set(p,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",o)===!1&&l.addEventListener("dispose",o),s.get(l)!==c&&(n.update(l.instanceMatrix,t.ARRAY_BUFFER),l.instanceColor!==null&&n.update(l.instanceColor,t.ARRAY_BUFFER),s.set(l,c))),l.isSkinnedMesh){let h=l.skeleton;s.get(h)!==c&&(h.update(),s.set(h,c))}return p}function a(){s=new WeakMap}function o(l){let c=l.target;c.removeEventListener("dispose",o),n.remove(c.instanceMatrix),c.instanceColor!==null&&n.remove(c.instanceColor)}return{update:r,dispose:a}}var OA=new Yt,yA=new cs(1,1),FA=new Rl,zA=new ju,HA=new Ll,_A=[],AA=[],SA=new Float32Array(16),MA=new Float32Array(9),EA=new Float32Array(4);function uo(t,e,n){let i=t[0];if(i<=0||i>0)return t;let s=e*n,r=_A[s];if(r===void 0&&(r=new Float32Array(s),_A[s]=r),e!==0){i.toArray(r,0);for(let a=1,o=0;a!==e;++a)o+=n,t[a].toArray(r,o)}return r}function Zt(t,e){if(t.length!==e.length)return!1;for(let n=0,i=t.length;n<i;n++)if(t[n]!==e[n])return!1;return!0}function Kt(t,e){for(let n=0,i=e.length;n<i;n++)t[n]=e[n]}function uh(t,e){let n=AA[e];n===void 0&&(n=new Int32Array(e),AA[e]=n);for(let i=0;i!==e;++i)n[i]=t.allocateTextureUnit();return n}function Rw(t,e){let n=this.cache;n[0]!==e&&(t.uniform1f(this.addr,e),n[0]=e)}function Dw(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2f(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Zt(n,e))return;t.uniform2fv(this.addr,e),Kt(n,e)}}function Uw(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3f(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else if(e.r!==void 0)(n[0]!==e.r||n[1]!==e.g||n[2]!==e.b)&&(t.uniform3f(this.addr,e.r,e.g,e.b),n[0]=e.r,n[1]=e.g,n[2]=e.b);else{if(Zt(n,e))return;t.uniform3fv(this.addr,e),Kt(n,e)}}function Bw(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4f(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Zt(n,e))return;t.uniform4fv(this.addr,e),Kt(n,e)}}function Iw(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Zt(n,e))return;t.uniformMatrix2fv(this.addr,!1,e),Kt(n,e)}else{if(Zt(n,i))return;EA.set(i),t.uniformMatrix2fv(this.addr,!1,EA),Kt(n,i)}}function Pw(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Zt(n,e))return;t.uniformMatrix3fv(this.addr,!1,e),Kt(n,e)}else{if(Zt(n,i))return;MA.set(i),t.uniformMatrix3fv(this.addr,!1,MA),Kt(n,i)}}function Lw(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Zt(n,e))return;t.uniformMatrix4fv(this.addr,!1,e),Kt(n,e)}else{if(Zt(n,i))return;SA.set(i),t.uniformMatrix4fv(this.addr,!1,SA),Kt(n,i)}}function Nw(t,e){let n=this.cache;n[0]!==e&&(t.uniform1i(this.addr,e),n[0]=e)}function Ow(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2i(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Zt(n,e))return;t.uniform2iv(this.addr,e),Kt(n,e)}}function Fw(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3i(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(Zt(n,e))return;t.uniform3iv(this.addr,e),Kt(n,e)}}function zw(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4i(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Zt(n,e))return;t.uniform4iv(this.addr,e),Kt(n,e)}}function Hw(t,e){let n=this.cache;n[0]!==e&&(t.uniform1ui(this.addr,e),n[0]=e)}function Gw(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2ui(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Zt(n,e))return;t.uniform2uiv(this.addr,e),Kt(n,e)}}function kw(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3ui(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(Zt(n,e))return;t.uniform3uiv(this.addr,e),Kt(n,e)}}function Vw(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4ui(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Zt(n,e))return;t.uniform4uiv(this.addr,e),Kt(n,e)}}function Ww(t,e,n){let i=this.cache,s=n.allocateTextureUnit();i[0]!==s&&(t.uniform1i(this.addr,s),i[0]=s);let r;this.type===t.SAMPLER_2D_SHADOW?(yA.compareFunction=zm,r=yA):r=OA,n.setTexture2D(e||r,s)}function Xw(t,e,n){let i=this.cache,s=n.allocateTextureUnit();i[0]!==s&&(t.uniform1i(this.addr,s),i[0]=s),n.setTexture3D(e||zA,s)}function Yw(t,e,n){let i=this.cache,s=n.allocateTextureUnit();i[0]!==s&&(t.uniform1i(this.addr,s),i[0]=s),n.setTextureCube(e||HA,s)}function qw(t,e,n){let i=this.cache,s=n.allocateTextureUnit();i[0]!==s&&(t.uniform1i(this.addr,s),i[0]=s),n.setTexture2DArray(e||FA,s)}function Qw(t){switch(t){case 5126:return Rw;case 35664:return Dw;case 35665:return Uw;case 35666:return Bw;case 35674:return Iw;case 35675:return Pw;case 35676:return Lw;case 5124:case 35670:return Nw;case 35667:case 35671:return Ow;case 35668:case 35672:return Fw;case 35669:case 35673:return zw;case 5125:return Hw;case 36294:return Gw;case 36295:return kw;case 36296:return Vw;case 35678:case 36198:case 36298:case 36306:case 35682:return Ww;case 35679:case 36299:case 36307:return Xw;case 35680:case 36300:case 36308:case 36293:return Yw;case 36289:case 36303:case 36311:case 36292:return qw}}function Zw(t,e){t.uniform1fv(this.addr,e)}function Kw(t,e){let n=uo(e,this.size,2);t.uniform2fv(this.addr,n)}function Jw(t,e){let n=uo(e,this.size,3);t.uniform3fv(this.addr,n)}function jw(t,e){let n=uo(e,this.size,4);t.uniform4fv(this.addr,n)}function $w(t,e){let n=uo(e,this.size,4);t.uniformMatrix2fv(this.addr,!1,n)}function eC(t,e){let n=uo(e,this.size,9);t.uniformMatrix3fv(this.addr,!1,n)}function tC(t,e){let n=uo(e,this.size,16);t.uniformMatrix4fv(this.addr,!1,n)}function nC(t,e){t.uniform1iv(this.addr,e)}function iC(t,e){t.uniform2iv(this.addr,e)}function sC(t,e){t.uniform3iv(this.addr,e)}function rC(t,e){t.uniform4iv(this.addr,e)}function aC(t,e){t.uniform1uiv(this.addr,e)}function oC(t,e){t.uniform2uiv(this.addr,e)}function lC(t,e){t.uniform3uiv(this.addr,e)}function cC(t,e){t.uniform4uiv(this.addr,e)}function uC(t,e,n){let i=this.cache,s=e.length,r=uh(n,s);Zt(i,r)||(t.uniform1iv(this.addr,r),Kt(i,r));for(let a=0;a!==s;++a)n.setTexture2D(e[a]||OA,r[a])}function fC(t,e,n){let i=this.cache,s=e.length,r=uh(n,s);Zt(i,r)||(t.uniform1iv(this.addr,r),Kt(i,r));for(let a=0;a!==s;++a)n.setTexture3D(e[a]||zA,r[a])}function hC(t,e,n){let i=this.cache,s=e.length,r=uh(n,s);Zt(i,r)||(t.uniform1iv(this.addr,r),Kt(i,r));for(let a=0;a!==s;++a)n.setTextureCube(e[a]||HA,r[a])}function dC(t,e,n){let i=this.cache,s=e.length,r=uh(n,s);Zt(i,r)||(t.uniform1iv(this.addr,r),Kt(i,r));for(let a=0;a!==s;++a)n.setTexture2DArray(e[a]||FA,r[a])}function pC(t){switch(t){case 5126:return Zw;case 35664:return Kw;case 35665:return Jw;case 35666:return jw;case 35674:return $w;case 35675:return eC;case 35676:return tC;case 5124:case 35670:return nC;case 35667:case 35671:return iC;case 35668:case 35672:return sC;case 35669:case 35673:return rC;case 5125:return aC;case 36294:return oC;case 36295:return lC;case 36296:return cC;case 35678:case 36198:case 36298:case 36306:case 35682:return uC;case 35679:case 36299:case 36307:return fC;case 35680:case 36300:case 36308:case 36293:return hC;case 36289:case 36303:case 36311:case 36292:return dC}}var Jm=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.setValue=Qw(n.type)}},jm=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.size=n.size,this.setValue=pC(n.type)}},$m=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,n,i){let s=this.seq;for(let r=0,a=s.length;r!==a;++r){let o=s[r];o.setValue(e,n[o.id],i)}}},Km=/(\w+)(\])?(\[|\.)?/g;function TA(t,e){t.seq.push(e),t.map[e.id]=e}function mC(t,e,n){let i=t.name,s=i.length;for(Km.lastIndex=0;;){let r=Km.exec(i),a=Km.lastIndex,o=r[1],l=r[2]==="]",c=r[3];if(l&&(o=o|0),c===void 0||c==="["&&a+2===s){TA(n,c===void 0?new Jm(o,t,e):new jm(o,t,e));break}else{let p=n.map[o];p===void 0&&(p=new $m(o),TA(n,p)),n=p}}}var co=class{constructor(e,n){this.seq=[],this.map={};let i=e.getProgramParameter(n,e.ACTIVE_UNIFORMS);for(let s=0;s<i;++s){let r=e.getActiveUniform(n,s),a=e.getUniformLocation(n,r.name);mC(r,a,this)}}setValue(e,n,i,s){let r=this.map[n];r!==void 0&&r.setValue(e,i,s)}setOptional(e,n,i){let s=n[i];s!==void 0&&this.setValue(e,i,s)}static upload(e,n,i,s){for(let r=0,a=n.length;r!==a;++r){let o=n[r],l=i[o.id];l.needsUpdate!==!1&&o.setValue(e,l.value,s)}}static seqWithValue(e,n){let i=[];for(let s=0,r=e.length;s!==r;++s){let a=e[s];a.id in n&&i.push(a)}return i}};function bA(t,e,n){let i=t.createShader(e);return t.shaderSource(i,n),t.compileShader(i),i}var gC=37297,vC=0;function xC(t,e){let n=t.split(`
`),i=[],s=Math.max(e-6,0),r=Math.min(e+6,n.length);for(let a=s;a<r;a++){let o=a+1;i.push(`${o===e?">":" "} ${o}: ${n[a]}`)}return i.join(`
`)}var wA=new Ne;function yC(t){je._getMatrix(wA,je.workingColorSpace,t);let e=`mat3( ${wA.elements.map(n=>n.toFixed(4))} )`;switch(je.getTransfer(t)){case bl:return[e,"LinearTransferOETF"];case lt:return[e,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",t),[e,"LinearTransferOETF"]}}function CA(t,e,n){let i=t.getShaderParameter(e,t.COMPILE_STATUS),r=(t.getShaderInfoLog(e)||"").trim();if(i&&r==="")return"";let a=/ERROR: 0:(\d+)/.exec(r);if(a){let o=parseInt(a[1]);return n.toUpperCase()+`

`+r+`

`+xC(t.getShaderSource(e),o)}else return r}function _C(t,e){let n=yC(e);return[`vec4 ${t}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,"}"].join(`
`)}function AC(t,e){let n;switch(e){case W_:n="Linear";break;case X_:n="Reinhard";break;case Y_:n="Cineon";break;case q_:n="ACESFilmic";break;case Z_:n="AgX";break;case K_:n="Neutral";break;case Q_:n="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),n="Linear"}return"vec3 "+t+"( vec3 color ) { return "+n+"ToneMapping( color ); }"}var ah=new z;function SC(){je.getLuminanceCoefficients(ah);let t=ah.x.toFixed(4),e=ah.y.toFixed(4),n=ah.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${t}, ${e}, ${n} );`,"	return dot( weights, rgb );","}"].join(`
`)}function MC(t){return[t.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",t.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Ql).join(`
`)}function EC(t){let e=[];for(let n in t){let i=t[n];i!==!1&&e.push("#define "+n+" "+i)}return e.join(`
`)}function TC(t,e){let n={},i=t.getProgramParameter(e,t.ACTIVE_ATTRIBUTES);for(let s=0;s<i;s++){let r=t.getActiveAttrib(e,s),a=r.name,o=1;r.type===t.FLOAT_MAT2&&(o=2),r.type===t.FLOAT_MAT3&&(o=3),r.type===t.FLOAT_MAT4&&(o=4),n[a]={type:r.type,location:t.getAttribLocation(e,a),locationSize:o}}return n}function Ql(t){return t!==""}function RA(t,e){let n=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return t.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function DA(t,e){return t.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var bC=/^[ \t]*#include +<([\w\d./]+)>/gm;function eg(t){return t.replace(bC,CC)}var wC=new Map;function CC(t,e){let n=He[e];if(n===void 0){let i=wC.get(e);if(i!==void 0)n=He[i],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return eg(n)}var RC=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function UA(t){return t.replace(RC,DC)}function DC(t,e,n,i){let s="";for(let r=parseInt(e);r<parseInt(n);r++)s+=i.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function BA(t){let e=`precision ${t.precision} float;
	precision ${t.precision} int;
	precision ${t.precision} sampler2D;
	precision ${t.precision} samplerCube;
	precision ${t.precision} sampler3D;
	precision ${t.precision} sampler2DArray;
	precision ${t.precision} sampler2DShadow;
	precision ${t.precision} samplerCubeShadow;
	precision ${t.precision} sampler2DArrayShadow;
	precision ${t.precision} isampler2D;
	precision ${t.precision} isampler3D;
	precision ${t.precision} isamplerCube;
	precision ${t.precision} isampler2DArray;
	precision ${t.precision} usampler2D;
	precision ${t.precision} usampler3D;
	precision ${t.precision} usamplerCube;
	precision ${t.precision} usampler2DArray;
	`;return t.precision==="highp"?e+=`
#define HIGH_PRECISION`:t.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:t.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function UC(t){let e="SHADOWMAP_TYPE_BASIC";return t.shadowMapType===Tm?e="SHADOWMAP_TYPE_PCF":t.shadowMapType===M_?e="SHADOWMAP_TYPE_PCF_SOFT":t.shadowMapType===Li&&(e="SHADOWMAP_TYPE_VSM"),e}function BC(t){let e="ENVMAP_TYPE_CUBE";if(t.envMap)switch(t.envMapMode){case Nr:case Or:e="ENVMAP_TYPE_CUBE";break;case Hl:e="ENVMAP_TYPE_CUBE_UV";break}return e}function IC(t){let e="ENVMAP_MODE_REFLECTION";if(t.envMap)switch(t.envMapMode){case Or:e="ENVMAP_MODE_REFRACTION";break}return e}function PC(t){let e="ENVMAP_BLENDING_NONE";if(t.envMap)switch(t.combine){case Rm:e="ENVMAP_BLENDING_MULTIPLY";break;case k_:e="ENVMAP_BLENDING_MIX";break;case V_:e="ENVMAP_BLENDING_ADD";break}return e}function LC(t){let e=t.envMapCubeUVHeight;if(e===null)return null;let n=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,n),112)),texelHeight:i,maxMip:n}}function NC(t,e,n,i){let s=t.getContext(),r=n.defines,a=n.vertexShader,o=n.fragmentShader,l=UC(n),c=BC(n),f=IC(n),p=PC(n),h=LC(n),d=MC(n),y=EC(r),_=s.createProgram(),m,u,g=n.glslVersion?"#version "+n.glslVersion+`
`:"";n.isRawShaderMaterial?(m=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,y].filter(Ql).join(`
`),m.length>0&&(m+=`
`),u=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,y].filter(Ql).join(`
`),u.length>0&&(u+=`
`)):(m=[BA(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,y,n.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",n.batching?"#define USE_BATCHING":"",n.batchingColor?"#define USE_BATCHING_COLOR":"",n.instancing?"#define USE_INSTANCING":"",n.instancingColor?"#define USE_INSTANCING_COLOR":"",n.instancingMorph?"#define USE_INSTANCING_MORPH":"",n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.map?"#define USE_MAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+f:"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.displacementMap?"#define USE_DISPLACEMENTMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.mapUv?"#define MAP_UV "+n.mapUv:"",n.alphaMapUv?"#define ALPHAMAP_UV "+n.alphaMapUv:"",n.lightMapUv?"#define LIGHTMAP_UV "+n.lightMapUv:"",n.aoMapUv?"#define AOMAP_UV "+n.aoMapUv:"",n.emissiveMapUv?"#define EMISSIVEMAP_UV "+n.emissiveMapUv:"",n.bumpMapUv?"#define BUMPMAP_UV "+n.bumpMapUv:"",n.normalMapUv?"#define NORMALMAP_UV "+n.normalMapUv:"",n.displacementMapUv?"#define DISPLACEMENTMAP_UV "+n.displacementMapUv:"",n.metalnessMapUv?"#define METALNESSMAP_UV "+n.metalnessMapUv:"",n.roughnessMapUv?"#define ROUGHNESSMAP_UV "+n.roughnessMapUv:"",n.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+n.anisotropyMapUv:"",n.clearcoatMapUv?"#define CLEARCOATMAP_UV "+n.clearcoatMapUv:"",n.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+n.clearcoatNormalMapUv:"",n.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+n.clearcoatRoughnessMapUv:"",n.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+n.iridescenceMapUv:"",n.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+n.iridescenceThicknessMapUv:"",n.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+n.sheenColorMapUv:"",n.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+n.sheenRoughnessMapUv:"",n.specularMapUv?"#define SPECULARMAP_UV "+n.specularMapUv:"",n.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+n.specularColorMapUv:"",n.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+n.specularIntensityMapUv:"",n.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+n.transmissionMapUv:"",n.thicknessMapUv?"#define THICKNESSMAP_UV "+n.thicknessMapUv:"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexColors?"#define USE_COLOR":"",n.vertexAlphas?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.flatShading?"#define FLAT_SHADED":"",n.skinning?"#define USE_SKINNING":"",n.morphTargets?"#define USE_MORPHTARGETS":"",n.morphNormals&&n.flatShading===!1?"#define USE_MORPHNORMALS":"",n.morphColors?"#define USE_MORPHCOLORS":"",n.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+n.morphTextureStride:"",n.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+n.morphTargetsCount:"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.sizeAttenuation?"#define USE_SIZEATTENUATION":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Ql).join(`
`),u=[BA(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,y,n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",n.map?"#define USE_MAP":"",n.matcap?"#define USE_MATCAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+c:"",n.envMap?"#define "+f:"",n.envMap?"#define "+p:"",h?"#define CUBEUV_TEXEL_WIDTH "+h.texelWidth:"",h?"#define CUBEUV_TEXEL_HEIGHT "+h.texelHeight:"",h?"#define CUBEUV_MAX_MIP "+h.maxMip+".0":"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoat?"#define USE_CLEARCOAT":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.dispersion?"#define USE_DISPERSION":"",n.iridescence?"#define USE_IRIDESCENCE":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaTest?"#define USE_ALPHATEST":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.sheen?"#define USE_SHEEN":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexColors||n.instancingColor||n.batchingColor?"#define USE_COLOR":"",n.vertexAlphas?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.gradientMap?"#define USE_GRADIENTMAP":"",n.flatShading?"#define FLAT_SHADED":"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",n.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",n.toneMapping!==us?"#define TONE_MAPPING":"",n.toneMapping!==us?He.tonemapping_pars_fragment:"",n.toneMapping!==us?AC("toneMapping",n.toneMapping):"",n.dithering?"#define DITHERING":"",n.opaque?"#define OPAQUE":"",He.colorspace_pars_fragment,_C("linearToOutputTexel",n.outputColorSpace),SC(),n.useDepthPacking?"#define DEPTH_PACKING "+n.depthPacking:"",`
`].filter(Ql).join(`
`)),a=eg(a),a=RA(a,n),a=DA(a,n),o=eg(o),o=RA(o,n),o=DA(o,n),a=UA(a),o=UA(o),n.isRawShaderMaterial!==!0&&(g=`#version 300 es
`,m=[d,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,u=["#define varying in",n.glslVersion===Yl?"":"layout(location = 0) out highp vec4 pc_fragColor;",n.glslVersion===Yl?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+u);let v=g+m+a,x=g+u+o,T=bA(s,s.VERTEX_SHADER,v),C=bA(s,s.FRAGMENT_SHADER,x);s.attachShader(_,T),s.attachShader(_,C),n.index0AttributeName!==void 0?s.bindAttribLocation(_,0,n.index0AttributeName):n.morphTargets===!0&&s.bindAttribLocation(_,0,"position"),s.linkProgram(_);function w(U){if(t.debug.checkShaderErrors){let G=s.getProgramInfoLog(_)||"",V=s.getShaderInfoLog(T)||"",Y=s.getShaderInfoLog(C)||"",O=G.trim(),N=V.trim(),J=Y.trim(),k=!0,se=!0;if(s.getProgramParameter(_,s.LINK_STATUS)===!1)if(k=!1,typeof t.debug.onShaderError=="function")t.debug.onShaderError(s,_,T,C);else{let pe=CA(s,T,"vertex"),Me=CA(s,C,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(_,s.VALIDATE_STATUS)+`

Material Name: `+U.name+`
Material Type: `+U.type+`

Program Info Log: `+O+`
`+pe+`
`+Me)}else O!==""?console.warn("THREE.WebGLProgram: Program Info Log:",O):(N===""||J==="")&&(se=!1);se&&(U.diagnostics={runnable:k,programLog:O,vertexShader:{log:N,prefix:m},fragmentShader:{log:J,prefix:u}})}s.deleteShader(T),s.deleteShader(C),D=new co(s,_),E=TC(s,_)}let D;this.getUniforms=function(){return D===void 0&&w(this),D};let E;this.getAttributes=function(){return E===void 0&&w(this),E};let M=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return M===!1&&(M=s.getProgramParameter(_,gC)),M},this.destroy=function(){i.releaseStatesOfProgram(this),s.deleteProgram(_),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=vC++,this.cacheKey=e,this.usedTimes=1,this.program=_,this.vertexShader=T,this.fragmentShader=C,this}var OC=0,tg=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let n=e.vertexShader,i=e.fragmentShader,s=this._getShaderStage(n),r=this._getShaderStage(i),a=this._getShaderCacheForMaterial(e);return a.has(s)===!1&&(a.add(s),s.usedTimes++),a.has(r)===!1&&(a.add(r),r.usedTimes++),this}remove(e){let n=this.materialCache.get(e);for(let i of n)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let n=this.materialCache,i=n.get(e);return i===void 0&&(i=new Set,n.set(e,i)),i}_getShaderStage(e){let n=this.shaderCache,i=n.get(e);return i===void 0&&(i=new ng(e),n.set(e,i)),i}},ng=class{constructor(e){this.id=OC++,this.code=e,this.usedTimes=0}};function FC(t,e,n,i,s,r,a){let o=new Dl,l=new tg,c=new Set,f=[],p=s.logarithmicDepthBuffer,h=s.vertexTextures,d=s.precision,y={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(E){return c.add(E),E===0?"uv":`uv${E}`}function m(E,M,U,G,V){let Y=G.fog,O=V.geometry,N=E.isMeshStandardMaterial?G.environment:null,J=(E.isMeshStandardMaterial?n:e).get(E.envMap||N),k=J&&J.mapping===Hl?J.image.height:null,se=y[E.type];E.precision!==null&&(d=s.getMaxPrecision(E.precision),d!==E.precision&&console.warn("THREE.WebGLProgram.getParameters:",E.precision,"not supported, using",d,"instead."));let pe=O.morphAttributes.position||O.morphAttributes.normal||O.morphAttributes.color,Me=pe!==void 0?pe.length:0,Fe=0;O.morphAttributes.position!==void 0&&(Fe=1),O.morphAttributes.normal!==void 0&&(Fe=2),O.morphAttributes.color!==void 0&&(Fe=3);let rt,ht,Je,q;if(se){let st=Oi[se];rt=st.vertexShader,ht=st.fragmentShader}else rt=E.vertexShader,ht=E.fragmentShader,l.update(E),Je=l.getVertexShaderID(E),q=l.getFragmentShaderID(E);let K=t.getRenderTarget(),oe=t.state.buffers.depth.getReversed(),Te=V.isInstancedMesh===!0,ve=V.isBatchedMesh===!0,ke=!!E.map,Jt=!!E.matcap,R=!!J,$e=!!E.aoMap,Be=!!E.lightMap,le=!!E.bumpMap,re=!!E.normalMap,Ze=!!E.displacementMap,de=!!E.emissiveMap,Ie=!!E.metalnessMap,Nt=!!E.roughnessMap,It=E.anisotropy>0,b=E.clearcoat>0,A=E.dispersion>0,L=E.iridescence>0,X=E.sheen>0,j=E.transmission>0,W=It&&!!E.anisotropyMap,Ee=b&&!!E.clearcoatMap,ie=b&&!!E.clearcoatNormalMap,_e=b&&!!E.clearcoatRoughnessMap,Ae=L&&!!E.iridescenceMap,te=L&&!!E.iridescenceThicknessMap,he=X&&!!E.sheenColorMap,Re=X&&!!E.sheenRoughnessMap,Se=!!E.specularMap,ue=!!E.specularColorMap,Oe=!!E.specularIntensityMap,B=j&&!!E.transmissionMap,ne=j&&!!E.thicknessMap,ae=!!E.gradientMap,ge=!!E.alphaMap,$=E.alphaTest>0,Z=!!E.alphaHash,ye=!!E.extensions,Pe=us;E.toneMapped&&(K===null||K.isXRRenderTarget===!0)&&(Pe=t.toneMapping);let mt={shaderID:se,shaderType:E.type,shaderName:E.name,vertexShader:rt,fragmentShader:ht,defines:E.defines,customVertexShaderID:Je,customFragmentShaderID:q,isRawShaderMaterial:E.isRawShaderMaterial===!0,glslVersion:E.glslVersion,precision:d,batching:ve,batchingColor:ve&&V._colorsTexture!==null,instancing:Te,instancingColor:Te&&V.instanceColor!==null,instancingMorph:Te&&V.morphTexture!==null,supportsVertexTextures:h,outputColorSpace:K===null?t.outputColorSpace:K.isXRRenderTarget===!0?K.texture.colorSpace:xi,alphaToCoverage:!!E.alphaToCoverage,map:ke,matcap:Jt,envMap:R,envMapMode:R&&J.mapping,envMapCubeUVHeight:k,aoMap:$e,lightMap:Be,bumpMap:le,normalMap:re,displacementMap:h&&Ze,emissiveMap:de,normalMapObjectSpace:re&&E.normalMapType===eA,normalMapTangentSpace:re&&E.normalMapType===$_,metalnessMap:Ie,roughnessMap:Nt,anisotropy:It,anisotropyMap:W,clearcoat:b,clearcoatMap:Ee,clearcoatNormalMap:ie,clearcoatRoughnessMap:_e,dispersion:A,iridescence:L,iridescenceMap:Ae,iridescenceThicknessMap:te,sheen:X,sheenColorMap:he,sheenRoughnessMap:Re,specularMap:Se,specularColorMap:ue,specularIntensityMap:Oe,transmission:j,transmissionMap:B,thicknessMap:ne,gradientMap:ae,opaque:E.transparent===!1&&E.blending===Br&&E.alphaToCoverage===!1,alphaMap:ge,alphaTest:$,alphaHash:Z,combine:E.combine,mapUv:ke&&_(E.map.channel),aoMapUv:$e&&_(E.aoMap.channel),lightMapUv:Be&&_(E.lightMap.channel),bumpMapUv:le&&_(E.bumpMap.channel),normalMapUv:re&&_(E.normalMap.channel),displacementMapUv:Ze&&_(E.displacementMap.channel),emissiveMapUv:de&&_(E.emissiveMap.channel),metalnessMapUv:Ie&&_(E.metalnessMap.channel),roughnessMapUv:Nt&&_(E.roughnessMap.channel),anisotropyMapUv:W&&_(E.anisotropyMap.channel),clearcoatMapUv:Ee&&_(E.clearcoatMap.channel),clearcoatNormalMapUv:ie&&_(E.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:_e&&_(E.clearcoatRoughnessMap.channel),iridescenceMapUv:Ae&&_(E.iridescenceMap.channel),iridescenceThicknessMapUv:te&&_(E.iridescenceThicknessMap.channel),sheenColorMapUv:he&&_(E.sheenColorMap.channel),sheenRoughnessMapUv:Re&&_(E.sheenRoughnessMap.channel),specularMapUv:Se&&_(E.specularMap.channel),specularColorMapUv:ue&&_(E.specularColorMap.channel),specularIntensityMapUv:Oe&&_(E.specularIntensityMap.channel),transmissionMapUv:B&&_(E.transmissionMap.channel),thicknessMapUv:ne&&_(E.thicknessMap.channel),alphaMapUv:ge&&_(E.alphaMap.channel),vertexTangents:!!O.attributes.tangent&&(re||It),vertexColors:E.vertexColors,vertexAlphas:E.vertexColors===!0&&!!O.attributes.color&&O.attributes.color.itemSize===4,pointsUvs:V.isPoints===!0&&!!O.attributes.uv&&(ke||ge),fog:!!Y,useFog:E.fog===!0,fogExp2:!!Y&&Y.isFogExp2,flatShading:E.flatShading===!0&&E.wireframe===!1,sizeAttenuation:E.sizeAttenuation===!0,logarithmicDepthBuffer:p,reversedDepthBuffer:oe,skinning:V.isSkinnedMesh===!0,morphTargets:O.morphAttributes.position!==void 0,morphNormals:O.morphAttributes.normal!==void 0,morphColors:O.morphAttributes.color!==void 0,morphTargetsCount:Me,morphTextureStride:Fe,numDirLights:M.directional.length,numPointLights:M.point.length,numSpotLights:M.spot.length,numSpotLightMaps:M.spotLightMap.length,numRectAreaLights:M.rectArea.length,numHemiLights:M.hemi.length,numDirLightShadows:M.directionalShadowMap.length,numPointLightShadows:M.pointShadowMap.length,numSpotLightShadows:M.spotShadowMap.length,numSpotLightShadowsWithMaps:M.numSpotLightShadowsWithMaps,numLightProbes:M.numLightProbes,numClippingPlanes:a.numPlanes,numClipIntersection:a.numIntersection,dithering:E.dithering,shadowMapEnabled:t.shadowMap.enabled&&U.length>0,shadowMapType:t.shadowMap.type,toneMapping:Pe,decodeVideoTexture:ke&&E.map.isVideoTexture===!0&&je.getTransfer(E.map.colorSpace)===lt,decodeVideoTextureEmissive:de&&E.emissiveMap.isVideoTexture===!0&&je.getTransfer(E.emissiveMap.colorSpace)===lt,premultipliedAlpha:E.premultipliedAlpha,doubleSided:E.side===Sn,flipSided:E.side===Gt,useDepthPacking:E.depthPacking>=0,depthPacking:E.depthPacking||0,index0AttributeName:E.index0AttributeName,extensionClipCullDistance:ye&&E.extensions.clipCullDistance===!0&&i.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(ye&&E.extensions.multiDraw===!0||ve)&&i.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:i.has("KHR_parallel_shader_compile"),customProgramCacheKey:E.customProgramCacheKey()};return mt.vertexUv1s=c.has(1),mt.vertexUv2s=c.has(2),mt.vertexUv3s=c.has(3),c.clear(),mt}function u(E){let M=[];if(E.shaderID?M.push(E.shaderID):(M.push(E.customVertexShaderID),M.push(E.customFragmentShaderID)),E.defines!==void 0)for(let U in E.defines)M.push(U),M.push(E.defines[U]);return E.isRawShaderMaterial===!1&&(g(M,E),v(M,E),M.push(t.outputColorSpace)),M.push(E.customProgramCacheKey),M.join()}function g(E,M){E.push(M.precision),E.push(M.outputColorSpace),E.push(M.envMapMode),E.push(M.envMapCubeUVHeight),E.push(M.mapUv),E.push(M.alphaMapUv),E.push(M.lightMapUv),E.push(M.aoMapUv),E.push(M.bumpMapUv),E.push(M.normalMapUv),E.push(M.displacementMapUv),E.push(M.emissiveMapUv),E.push(M.metalnessMapUv),E.push(M.roughnessMapUv),E.push(M.anisotropyMapUv),E.push(M.clearcoatMapUv),E.push(M.clearcoatNormalMapUv),E.push(M.clearcoatRoughnessMapUv),E.push(M.iridescenceMapUv),E.push(M.iridescenceThicknessMapUv),E.push(M.sheenColorMapUv),E.push(M.sheenRoughnessMapUv),E.push(M.specularMapUv),E.push(M.specularColorMapUv),E.push(M.specularIntensityMapUv),E.push(M.transmissionMapUv),E.push(M.thicknessMapUv),E.push(M.combine),E.push(M.fogExp2),E.push(M.sizeAttenuation),E.push(M.morphTargetsCount),E.push(M.morphAttributeCount),E.push(M.numDirLights),E.push(M.numPointLights),E.push(M.numSpotLights),E.push(M.numSpotLightMaps),E.push(M.numHemiLights),E.push(M.numRectAreaLights),E.push(M.numDirLightShadows),E.push(M.numPointLightShadows),E.push(M.numSpotLightShadows),E.push(M.numSpotLightShadowsWithMaps),E.push(M.numLightProbes),E.push(M.shadowMapType),E.push(M.toneMapping),E.push(M.numClippingPlanes),E.push(M.numClipIntersection),E.push(M.depthPacking)}function v(E,M){o.disableAll(),M.supportsVertexTextures&&o.enable(0),M.instancing&&o.enable(1),M.instancingColor&&o.enable(2),M.instancingMorph&&o.enable(3),M.matcap&&o.enable(4),M.envMap&&o.enable(5),M.normalMapObjectSpace&&o.enable(6),M.normalMapTangentSpace&&o.enable(7),M.clearcoat&&o.enable(8),M.iridescence&&o.enable(9),M.alphaTest&&o.enable(10),M.vertexColors&&o.enable(11),M.vertexAlphas&&o.enable(12),M.vertexUv1s&&o.enable(13),M.vertexUv2s&&o.enable(14),M.vertexUv3s&&o.enable(15),M.vertexTangents&&o.enable(16),M.anisotropy&&o.enable(17),M.alphaHash&&o.enable(18),M.batching&&o.enable(19),M.dispersion&&o.enable(20),M.batchingColor&&o.enable(21),M.gradientMap&&o.enable(22),E.push(o.mask),o.disableAll(),M.fog&&o.enable(0),M.useFog&&o.enable(1),M.flatShading&&o.enable(2),M.logarithmicDepthBuffer&&o.enable(3),M.reversedDepthBuffer&&o.enable(4),M.skinning&&o.enable(5),M.morphTargets&&o.enable(6),M.morphNormals&&o.enable(7),M.morphColors&&o.enable(8),M.premultipliedAlpha&&o.enable(9),M.shadowMapEnabled&&o.enable(10),M.doubleSided&&o.enable(11),M.flipSided&&o.enable(12),M.useDepthPacking&&o.enable(13),M.dithering&&o.enable(14),M.transmission&&o.enable(15),M.sheen&&o.enable(16),M.opaque&&o.enable(17),M.pointsUvs&&o.enable(18),M.decodeVideoTexture&&o.enable(19),M.decodeVideoTextureEmissive&&o.enable(20),M.alphaToCoverage&&o.enable(21),E.push(o.mask)}function x(E){let M=y[E.type],U;if(M){let G=Oi[M];U=fA.clone(G.uniforms)}else U=E.uniforms;return U}function T(E,M){let U;for(let G=0,V=f.length;G<V;G++){let Y=f[G];if(Y.cacheKey===M){U=Y,++U.usedTimes;break}}return U===void 0&&(U=new NC(t,M,E,r),f.push(U)),U}function C(E){if(--E.usedTimes===0){let M=f.indexOf(E);f[M]=f[f.length-1],f.pop(),E.destroy()}}function w(E){l.remove(E)}function D(){l.dispose()}return{getParameters:m,getProgramCacheKey:u,getUniforms:x,acquireProgram:T,releaseProgram:C,releaseShaderCache:w,programs:f,dispose:D}}function zC(){let t=new WeakMap;function e(a){return t.has(a)}function n(a){let o=t.get(a);return o===void 0&&(o={},t.set(a,o)),o}function i(a){t.delete(a)}function s(a,o,l){t.get(a)[o]=l}function r(){t=new WeakMap}return{has:e,get:n,remove:i,update:s,dispose:r}}function HC(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.material.id!==e.material.id?t.material.id-e.material.id:t.z!==e.z?t.z-e.z:t.id-e.id}function IA(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.z!==e.z?e.z-t.z:t.id-e.id}function PA(){let t=[],e=0,n=[],i=[],s=[];function r(){e=0,n.length=0,i.length=0,s.length=0}function a(p,h,d,y,_,m){let u=t[e];return u===void 0?(u={id:p.id,object:p,geometry:h,material:d,groupOrder:y,renderOrder:p.renderOrder,z:_,group:m},t[e]=u):(u.id=p.id,u.object=p,u.geometry=h,u.material=d,u.groupOrder=y,u.renderOrder=p.renderOrder,u.z=_,u.group=m),e++,u}function o(p,h,d,y,_,m){let u=a(p,h,d,y,_,m);d.transmission>0?i.push(u):d.transparent===!0?s.push(u):n.push(u)}function l(p,h,d,y,_,m){let u=a(p,h,d,y,_,m);d.transmission>0?i.unshift(u):d.transparent===!0?s.unshift(u):n.unshift(u)}function c(p,h){n.length>1&&n.sort(p||HC),i.length>1&&i.sort(h||IA),s.length>1&&s.sort(h||IA)}function f(){for(let p=e,h=t.length;p<h;p++){let d=t[p];if(d.id===null)break;d.id=null,d.object=null,d.geometry=null,d.material=null,d.group=null}}return{opaque:n,transmissive:i,transparent:s,init:r,push:o,unshift:l,finish:f,sort:c}}function GC(){let t=new WeakMap;function e(i,s){let r=t.get(i),a;return r===void 0?(a=new PA,t.set(i,[a])):s>=r.length?(a=new PA,r.push(a)):a=r[s],a}function n(){t=new WeakMap}return{get:e,dispose:n}}function kC(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={direction:new z,color:new qe};break;case"SpotLight":n={position:new z,direction:new z,color:new qe,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":n={position:new z,color:new qe,distance:0,decay:0};break;case"HemisphereLight":n={direction:new z,skyColor:new qe,groundColor:new qe};break;case"RectAreaLight":n={color:new qe,position:new z,halfWidth:new z,halfHeight:new z};break}return t[e.id]=n,n}}}function VC(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Le};break;case"SpotLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Le};break;case"PointLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Le,shadowCameraNear:1,shadowCameraFar:1e3};break}return t[e.id]=n,n}}}var WC=0;function XC(t,e){return(e.castShadow?2:0)-(t.castShadow?2:0)+(e.map?1:0)-(t.map?1:0)}function YC(t){let e=new kC,n=VC(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)i.probe.push(new z);let s=new z,r=new Xt,a=new Xt;function o(c){let f=0,p=0,h=0;for(let E=0;E<9;E++)i.probe[E].set(0,0,0);let d=0,y=0,_=0,m=0,u=0,g=0,v=0,x=0,T=0,C=0,w=0;c.sort(XC);for(let E=0,M=c.length;E<M;E++){let U=c[E],G=U.color,V=U.intensity,Y=U.distance,O=U.shadow&&U.shadow.map?U.shadow.map.texture:null;if(U.isAmbientLight)f+=G.r*V,p+=G.g*V,h+=G.b*V;else if(U.isLightProbe){for(let N=0;N<9;N++)i.probe[N].addScaledVector(U.sh.coefficients[N],V);w++}else if(U.isDirectionalLight){let N=e.get(U);if(N.color.copy(U.color).multiplyScalar(U.intensity),U.castShadow){let J=U.shadow,k=n.get(U);k.shadowIntensity=J.intensity,k.shadowBias=J.bias,k.shadowNormalBias=J.normalBias,k.shadowRadius=J.radius,k.shadowMapSize=J.mapSize,i.directionalShadow[d]=k,i.directionalShadowMap[d]=O,i.directionalShadowMatrix[d]=U.shadow.matrix,g++}i.directional[d]=N,d++}else if(U.isSpotLight){let N=e.get(U);N.position.setFromMatrixPosition(U.matrixWorld),N.color.copy(G).multiplyScalar(V),N.distance=Y,N.coneCos=Math.cos(U.angle),N.penumbraCos=Math.cos(U.angle*(1-U.penumbra)),N.decay=U.decay,i.spot[_]=N;let J=U.shadow;if(U.map&&(i.spotLightMap[T]=U.map,T++,J.updateMatrices(U),U.castShadow&&C++),i.spotLightMatrix[_]=J.matrix,U.castShadow){let k=n.get(U);k.shadowIntensity=J.intensity,k.shadowBias=J.bias,k.shadowNormalBias=J.normalBias,k.shadowRadius=J.radius,k.shadowMapSize=J.mapSize,i.spotShadow[_]=k,i.spotShadowMap[_]=O,x++}_++}else if(U.isRectAreaLight){let N=e.get(U);N.color.copy(G).multiplyScalar(V),N.halfWidth.set(U.width*.5,0,0),N.halfHeight.set(0,U.height*.5,0),i.rectArea[m]=N,m++}else if(U.isPointLight){let N=e.get(U);if(N.color.copy(U.color).multiplyScalar(U.intensity),N.distance=U.distance,N.decay=U.decay,U.castShadow){let J=U.shadow,k=n.get(U);k.shadowIntensity=J.intensity,k.shadowBias=J.bias,k.shadowNormalBias=J.normalBias,k.shadowRadius=J.radius,k.shadowMapSize=J.mapSize,k.shadowCameraNear=J.camera.near,k.shadowCameraFar=J.camera.far,i.pointShadow[y]=k,i.pointShadowMap[y]=O,i.pointShadowMatrix[y]=U.shadow.matrix,v++}i.point[y]=N,y++}else if(U.isHemisphereLight){let N=e.get(U);N.skyColor.copy(U.color).multiplyScalar(V),N.groundColor.copy(U.groundColor).multiplyScalar(V),i.hemi[u]=N,u++}}m>0&&(t.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=ce.LTC_FLOAT_1,i.rectAreaLTC2=ce.LTC_FLOAT_2):(i.rectAreaLTC1=ce.LTC_HALF_1,i.rectAreaLTC2=ce.LTC_HALF_2)),i.ambient[0]=f,i.ambient[1]=p,i.ambient[2]=h;let D=i.hash;(D.directionalLength!==d||D.pointLength!==y||D.spotLength!==_||D.rectAreaLength!==m||D.hemiLength!==u||D.numDirectionalShadows!==g||D.numPointShadows!==v||D.numSpotShadows!==x||D.numSpotMaps!==T||D.numLightProbes!==w)&&(i.directional.length=d,i.spot.length=_,i.rectArea.length=m,i.point.length=y,i.hemi.length=u,i.directionalShadow.length=g,i.directionalShadowMap.length=g,i.pointShadow.length=v,i.pointShadowMap.length=v,i.spotShadow.length=x,i.spotShadowMap.length=x,i.directionalShadowMatrix.length=g,i.pointShadowMatrix.length=v,i.spotLightMatrix.length=x+T-C,i.spotLightMap.length=T,i.numSpotLightShadowsWithMaps=C,i.numLightProbes=w,D.directionalLength=d,D.pointLength=y,D.spotLength=_,D.rectAreaLength=m,D.hemiLength=u,D.numDirectionalShadows=g,D.numPointShadows=v,D.numSpotShadows=x,D.numSpotMaps=T,D.numLightProbes=w,i.version=WC++)}function l(c,f){let p=0,h=0,d=0,y=0,_=0,m=f.matrixWorldInverse;for(let u=0,g=c.length;u<g;u++){let v=c[u];if(v.isDirectionalLight){let x=i.directional[p];x.direction.setFromMatrixPosition(v.matrixWorld),s.setFromMatrixPosition(v.target.matrixWorld),x.direction.sub(s),x.direction.transformDirection(m),p++}else if(v.isSpotLight){let x=i.spot[d];x.position.setFromMatrixPosition(v.matrixWorld),x.position.applyMatrix4(m),x.direction.setFromMatrixPosition(v.matrixWorld),s.setFromMatrixPosition(v.target.matrixWorld),x.direction.sub(s),x.direction.transformDirection(m),d++}else if(v.isRectAreaLight){let x=i.rectArea[y];x.position.setFromMatrixPosition(v.matrixWorld),x.position.applyMatrix4(m),a.identity(),r.copy(v.matrixWorld),r.premultiply(m),a.extractRotation(r),x.halfWidth.set(v.width*.5,0,0),x.halfHeight.set(0,v.height*.5,0),x.halfWidth.applyMatrix4(a),x.halfHeight.applyMatrix4(a),y++}else if(v.isPointLight){let x=i.point[h];x.position.setFromMatrixPosition(v.matrixWorld),x.position.applyMatrix4(m),h++}else if(v.isHemisphereLight){let x=i.hemi[_];x.direction.setFromMatrixPosition(v.matrixWorld),x.direction.transformDirection(m),_++}}}return{setup:o,setupView:l,state:i}}function LA(t){let e=new YC(t),n=[],i=[];function s(f){c.camera=f,n.length=0,i.length=0}function r(f){n.push(f)}function a(f){i.push(f)}function o(){e.setup(n)}function l(f){e.setupView(n,f)}let c={lightsArray:n,shadowsArray:i,camera:null,lights:e,transmissionRenderTarget:{}};return{init:s,state:c,setupLights:o,setupLightsView:l,pushLight:r,pushShadow:a}}function qC(t){let e=new WeakMap;function n(s,r=0){let a=e.get(s),o;return a===void 0?(o=new LA(t),e.set(s,[o])):r>=a.length?(o=new LA(t),a.push(o)):o=a[r],o}function i(){e=new WeakMap}return{get:n,dispose:i}}var QC=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,ZC=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function KC(t,e,n){let i=new Nl,s=new Le,r=new Le,a=new Bt,o=new nf({depthPacking:j_}),l=new sf,c={},f=n.maxTextureSize,p={[vi]:Gt,[Gt]:vi,[Sn]:Sn},h=new Qt({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Le},radius:{value:4}},vertexShader:QC,fragmentShader:ZC}),d=h.clone();d.defines.HORIZONTAL_PASS=1;let y=new Pi;y.setAttribute("position",new pn(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let _=new mn(y,h),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Tm;let u=this.type;this.render=function(C,w,D){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||C.length===0)return;let E=t.getRenderTarget(),M=t.getActiveCubeFace(),U=t.getActiveMipmapLevel(),G=t.state;G.setBlending(Xn),G.buffers.depth.getReversed()===!0?G.buffers.color.setClear(0,0,0,0):G.buffers.color.setClear(1,1,1,1),G.buffers.depth.setTest(!0),G.setScissorTest(!1);let V=u!==Li&&this.type===Li,Y=u===Li&&this.type!==Li;for(let O=0,N=C.length;O<N;O++){let J=C[O],k=J.shadow;if(k===void 0){console.warn("THREE.WebGLShadowMap:",J,"has no shadow.");continue}if(k.autoUpdate===!1&&k.needsUpdate===!1)continue;s.copy(k.mapSize);let se=k.getFrameExtents();if(s.multiply(se),r.copy(k.mapSize),(s.x>f||s.y>f)&&(s.x>f&&(r.x=Math.floor(f/se.x),s.x=r.x*se.x,k.mapSize.x=r.x),s.y>f&&(r.y=Math.floor(f/se.y),s.y=r.y*se.y,k.mapSize.y=r.y)),k.map===null||V===!0||Y===!0){let Me=this.type!==Li?{minFilter:ai,magFilter:ai}:{};k.map!==null&&k.map.dispose(),k.map=new qt(s.x,s.y,Me),k.map.texture.name=J.name+".shadowMap",k.camera.updateProjectionMatrix()}t.setRenderTarget(k.map),t.clear();let pe=k.getViewportCount();for(let Me=0;Me<pe;Me++){let Fe=k.getViewport(Me);a.set(r.x*Fe.x,r.y*Fe.y,r.x*Fe.z,r.y*Fe.w),G.viewport(a),k.updateMatrices(J,Me),i=k.getFrustum(),x(w,D,k.camera,J,this.type)}k.isPointLightShadow!==!0&&this.type===Li&&g(k,D),k.needsUpdate=!1}u=this.type,m.needsUpdate=!1,t.setRenderTarget(E,M,U)};function g(C,w){let D=e.update(_);h.defines.VSM_SAMPLES!==C.blurSamples&&(h.defines.VSM_SAMPLES=C.blurSamples,d.defines.VSM_SAMPLES=C.blurSamples,h.needsUpdate=!0,d.needsUpdate=!0),C.mapPass===null&&(C.mapPass=new qt(s.x,s.y)),h.uniforms.shadow_pass.value=C.map.texture,h.uniforms.resolution.value=C.mapSize,h.uniforms.radius.value=C.radius,t.setRenderTarget(C.mapPass),t.clear(),t.renderBufferDirect(w,null,D,h,_,null),d.uniforms.shadow_pass.value=C.mapPass.texture,d.uniforms.resolution.value=C.mapSize,d.uniforms.radius.value=C.radius,t.setRenderTarget(C.map),t.clear(),t.renderBufferDirect(w,null,D,d,_,null)}function v(C,w,D,E){let M=null,U=D.isPointLight===!0?C.customDistanceMaterial:C.customDepthMaterial;if(U!==void 0)M=U;else if(M=D.isPointLight===!0?l:o,t.localClippingEnabled&&w.clipShadows===!0&&Array.isArray(w.clippingPlanes)&&w.clippingPlanes.length!==0||w.displacementMap&&w.displacementScale!==0||w.alphaMap&&w.alphaTest>0||w.map&&w.alphaTest>0||w.alphaToCoverage===!0){let G=M.uuid,V=w.uuid,Y=c[G];Y===void 0&&(Y={},c[G]=Y);let O=Y[V];O===void 0&&(O=M.clone(),Y[V]=O,w.addEventListener("dispose",T)),M=O}if(M.visible=w.visible,M.wireframe=w.wireframe,E===Li?M.side=w.shadowSide!==null?w.shadowSide:w.side:M.side=w.shadowSide!==null?w.shadowSide:p[w.side],M.alphaMap=w.alphaMap,M.alphaTest=w.alphaToCoverage===!0?.5:w.alphaTest,M.map=w.map,M.clipShadows=w.clipShadows,M.clippingPlanes=w.clippingPlanes,M.clipIntersection=w.clipIntersection,M.displacementMap=w.displacementMap,M.displacementScale=w.displacementScale,M.displacementBias=w.displacementBias,M.wireframeLinewidth=w.wireframeLinewidth,M.linewidth=w.linewidth,D.isPointLight===!0&&M.isMeshDistanceMaterial===!0){let G=t.properties.get(M);G.light=D}return M}function x(C,w,D,E,M){if(C.visible===!1)return;if(C.layers.test(w.layers)&&(C.isMesh||C.isLine||C.isPoints)&&(C.castShadow||C.receiveShadow&&M===Li)&&(!C.frustumCulled||i.intersectsObject(C))){C.modelViewMatrix.multiplyMatrices(D.matrixWorldInverse,C.matrixWorld);let V=e.update(C),Y=C.material;if(Array.isArray(Y)){let O=V.groups;for(let N=0,J=O.length;N<J;N++){let k=O[N],se=Y[k.materialIndex];if(se&&se.visible){let pe=v(C,se,E,M);C.onBeforeShadow(t,C,w,D,V,pe,k),t.renderBufferDirect(D,null,V,pe,C,k),C.onAfterShadow(t,C,w,D,V,pe,k)}}}else if(Y.visible){let O=v(C,Y,E,M);C.onBeforeShadow(t,C,w,D,V,O,null),t.renderBufferDirect(D,null,V,O,C,null),C.onAfterShadow(t,C,w,D,V,O,null)}}let G=C.children;for(let V=0,Y=G.length;V<Y;V++)x(G[V],w,D,E,M)}function T(C){C.target.removeEventListener("dispose",T);for(let D in c){let E=c[D],M=C.target.uuid;M in E&&(E[M].dispose(),delete E[M])}}}var JC={[mf]:so,[gf]:yf,[vf]:_f,[Ir]:xf,[so]:mf,[yf]:gf,[_f]:vf,[xf]:Ir};function jC(t,e){function n(){let B=!1,ne=new Bt,ae=null,ge=new Bt(0,0,0,0);return{setMask:function($){ae!==$&&!B&&(t.colorMask($,$,$,$),ae=$)},setLocked:function($){B=$},setClear:function($,Z,ye,Pe,mt){mt===!0&&($*=Pe,Z*=Pe,ye*=Pe),ne.set($,Z,ye,Pe),ge.equals(ne)===!1&&(t.clearColor($,Z,ye,Pe),ge.copy(ne))},reset:function(){B=!1,ae=null,ge.set(-1,0,0,0)}}}function i(){let B=!1,ne=!1,ae=null,ge=null,$=null;return{setReversed:function(Z){if(ne!==Z){let ye=e.get("EXT_clip_control");Z?ye.clipControlEXT(ye.LOWER_LEFT_EXT,ye.ZERO_TO_ONE_EXT):ye.clipControlEXT(ye.LOWER_LEFT_EXT,ye.NEGATIVE_ONE_TO_ONE_EXT),ne=Z;let Pe=$;$=null,this.setClear(Pe)}},getReversed:function(){return ne},setTest:function(Z){Z?K(t.DEPTH_TEST):oe(t.DEPTH_TEST)},setMask:function(Z){ae!==Z&&!B&&(t.depthMask(Z),ae=Z)},setFunc:function(Z){if(ne&&(Z=JC[Z]),ge!==Z){switch(Z){case mf:t.depthFunc(t.NEVER);break;case so:t.depthFunc(t.ALWAYS);break;case gf:t.depthFunc(t.LESS);break;case Ir:t.depthFunc(t.LEQUAL);break;case vf:t.depthFunc(t.EQUAL);break;case xf:t.depthFunc(t.GEQUAL);break;case yf:t.depthFunc(t.GREATER);break;case _f:t.depthFunc(t.NOTEQUAL);break;default:t.depthFunc(t.LEQUAL)}ge=Z}},setLocked:function(Z){B=Z},setClear:function(Z){$!==Z&&(ne&&(Z=1-Z),t.clearDepth(Z),$=Z)},reset:function(){B=!1,ae=null,ge=null,$=null,ne=!1}}}function s(){let B=!1,ne=null,ae=null,ge=null,$=null,Z=null,ye=null,Pe=null,mt=null;return{setTest:function(st){B||(st?K(t.STENCIL_TEST):oe(t.STENCIL_TEST))},setMask:function(st){ne!==st&&!B&&(t.stencilMask(st),ne=st)},setFunc:function(st,Fi,_i){(ae!==st||ge!==Fi||$!==_i)&&(t.stencilFunc(st,Fi,_i),ae=st,ge=Fi,$=_i)},setOp:function(st,Fi,_i){(Z!==st||ye!==Fi||Pe!==_i)&&(t.stencilOp(st,Fi,_i),Z=st,ye=Fi,Pe=_i)},setLocked:function(st){B=st},setClear:function(st){mt!==st&&(t.clearStencil(st),mt=st)},reset:function(){B=!1,ne=null,ae=null,ge=null,$=null,Z=null,ye=null,Pe=null,mt=null}}}let r=new n,a=new i,o=new s,l=new WeakMap,c=new WeakMap,f={},p={},h=new WeakMap,d=[],y=null,_=!1,m=null,u=null,g=null,v=null,x=null,T=null,C=null,w=new qe(0,0,0),D=0,E=!1,M=null,U=null,G=null,V=null,Y=null,O=t.getParameter(t.MAX_COMBINED_TEXTURE_IMAGE_UNITS),N=!1,J=0,k=t.getParameter(t.VERSION);k.indexOf("WebGL")!==-1?(J=parseFloat(/^WebGL (\d)/.exec(k)[1]),N=J>=1):k.indexOf("OpenGL ES")!==-1&&(J=parseFloat(/^OpenGL ES (\d)/.exec(k)[1]),N=J>=2);let se=null,pe={},Me=t.getParameter(t.SCISSOR_BOX),Fe=t.getParameter(t.VIEWPORT),rt=new Bt().fromArray(Me),ht=new Bt().fromArray(Fe);function Je(B,ne,ae,ge){let $=new Uint8Array(4),Z=t.createTexture();t.bindTexture(B,Z),t.texParameteri(B,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(B,t.TEXTURE_MAG_FILTER,t.NEAREST);for(let ye=0;ye<ae;ye++)B===t.TEXTURE_3D||B===t.TEXTURE_2D_ARRAY?t.texImage3D(ne,0,t.RGBA,1,1,ge,0,t.RGBA,t.UNSIGNED_BYTE,$):t.texImage2D(ne+ye,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,$);return Z}let q={};q[t.TEXTURE_2D]=Je(t.TEXTURE_2D,t.TEXTURE_2D,1),q[t.TEXTURE_CUBE_MAP]=Je(t.TEXTURE_CUBE_MAP,t.TEXTURE_CUBE_MAP_POSITIVE_X,6),q[t.TEXTURE_2D_ARRAY]=Je(t.TEXTURE_2D_ARRAY,t.TEXTURE_2D_ARRAY,1,1),q[t.TEXTURE_3D]=Je(t.TEXTURE_3D,t.TEXTURE_3D,1,1),r.setClear(0,0,0,1),a.setClear(1),o.setClear(0),K(t.DEPTH_TEST),a.setFunc(Ir),le(!1),re(Em),K(t.CULL_FACE),$e(Xn);function K(B){f[B]!==!0&&(t.enable(B),f[B]=!0)}function oe(B){f[B]!==!1&&(t.disable(B),f[B]=!1)}function Te(B,ne){return p[B]!==ne?(t.bindFramebuffer(B,ne),p[B]=ne,B===t.DRAW_FRAMEBUFFER&&(p[t.FRAMEBUFFER]=ne),B===t.FRAMEBUFFER&&(p[t.DRAW_FRAMEBUFFER]=ne),!0):!1}function ve(B,ne){let ae=d,ge=!1;if(B){ae=h.get(ne),ae===void 0&&(ae=[],h.set(ne,ae));let $=B.textures;if(ae.length!==$.length||ae[0]!==t.COLOR_ATTACHMENT0){for(let Z=0,ye=$.length;Z<ye;Z++)ae[Z]=t.COLOR_ATTACHMENT0+Z;ae.length=$.length,ge=!0}}else ae[0]!==t.BACK&&(ae[0]=t.BACK,ge=!0);ge&&t.drawBuffers(ae)}function ke(B){return y!==B?(t.useProgram(B),y=B,!0):!1}let Jt={[Ys]:t.FUNC_ADD,[T_]:t.FUNC_SUBTRACT,[b_]:t.FUNC_REVERSE_SUBTRACT};Jt[w_]=t.MIN,Jt[C_]=t.MAX;let R={[R_]:t.ZERO,[D_]:t.ONE,[U_]:t.SRC_COLOR,[Wu]:t.SRC_ALPHA,[O_]:t.SRC_ALPHA_SATURATE,[L_]:t.DST_COLOR,[I_]:t.DST_ALPHA,[B_]:t.ONE_MINUS_SRC_COLOR,[Xu]:t.ONE_MINUS_SRC_ALPHA,[N_]:t.ONE_MINUS_DST_COLOR,[P_]:t.ONE_MINUS_DST_ALPHA,[F_]:t.CONSTANT_COLOR,[z_]:t.ONE_MINUS_CONSTANT_COLOR,[H_]:t.CONSTANT_ALPHA,[G_]:t.ONE_MINUS_CONSTANT_ALPHA};function $e(B,ne,ae,ge,$,Z,ye,Pe,mt,st){if(B===Xn){_===!0&&(oe(t.BLEND),_=!1);return}if(_===!1&&(K(t.BLEND),_=!0),B!==E_){if(B!==m||st!==E){if((u!==Ys||x!==Ys)&&(t.blendEquation(t.FUNC_ADD),u=Ys,x=Ys),st)switch(B){case Br:t.blendFuncSeparate(t.ONE,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case bm:t.blendFunc(t.ONE,t.ONE);break;case wm:t.blendFuncSeparate(t.ZERO,t.ONE_MINUS_SRC_COLOR,t.ZERO,t.ONE);break;case Cm:t.blendFuncSeparate(t.DST_COLOR,t.ONE_MINUS_SRC_ALPHA,t.ZERO,t.ONE);break;default:console.error("THREE.WebGLState: Invalid blending: ",B);break}else switch(B){case Br:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case bm:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE,t.ONE,t.ONE);break;case wm:console.error("THREE.WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case Cm:console.error("THREE.WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:console.error("THREE.WebGLState: Invalid blending: ",B);break}g=null,v=null,T=null,C=null,w.set(0,0,0),D=0,m=B,E=st}return}$=$||ne,Z=Z||ae,ye=ye||ge,(ne!==u||$!==x)&&(t.blendEquationSeparate(Jt[ne],Jt[$]),u=ne,x=$),(ae!==g||ge!==v||Z!==T||ye!==C)&&(t.blendFuncSeparate(R[ae],R[ge],R[Z],R[ye]),g=ae,v=ge,T=Z,C=ye),(Pe.equals(w)===!1||mt!==D)&&(t.blendColor(Pe.r,Pe.g,Pe.b,mt),w.copy(Pe),D=mt),m=B,E=!1}function Be(B,ne){B.side===Sn?oe(t.CULL_FACE):K(t.CULL_FACE);let ae=B.side===Gt;ne&&(ae=!ae),le(ae),B.blending===Br&&B.transparent===!1?$e(Xn):$e(B.blending,B.blendEquation,B.blendSrc,B.blendDst,B.blendEquationAlpha,B.blendSrcAlpha,B.blendDstAlpha,B.blendColor,B.blendAlpha,B.premultipliedAlpha),a.setFunc(B.depthFunc),a.setTest(B.depthTest),a.setMask(B.depthWrite),r.setMask(B.colorWrite);let ge=B.stencilWrite;o.setTest(ge),ge&&(o.setMask(B.stencilWriteMask),o.setFunc(B.stencilFunc,B.stencilRef,B.stencilFuncMask),o.setOp(B.stencilFail,B.stencilZFail,B.stencilZPass)),de(B.polygonOffset,B.polygonOffsetFactor,B.polygonOffsetUnits),B.alphaToCoverage===!0?K(t.SAMPLE_ALPHA_TO_COVERAGE):oe(t.SAMPLE_ALPHA_TO_COVERAGE)}function le(B){M!==B&&(B?t.frontFace(t.CW):t.frontFace(t.CCW),M=B)}function re(B){B!==A_?(K(t.CULL_FACE),B!==U&&(B===Em?t.cullFace(t.BACK):B===S_?t.cullFace(t.FRONT):t.cullFace(t.FRONT_AND_BACK))):oe(t.CULL_FACE),U=B}function Ze(B){B!==G&&(N&&t.lineWidth(B),G=B)}function de(B,ne,ae){B?(K(t.POLYGON_OFFSET_FILL),(V!==ne||Y!==ae)&&(t.polygonOffset(ne,ae),V=ne,Y=ae)):oe(t.POLYGON_OFFSET_FILL)}function Ie(B){B?K(t.SCISSOR_TEST):oe(t.SCISSOR_TEST)}function Nt(B){B===void 0&&(B=t.TEXTURE0+O-1),se!==B&&(t.activeTexture(B),se=B)}function It(B,ne,ae){ae===void 0&&(se===null?ae=t.TEXTURE0+O-1:ae=se);let ge=pe[ae];ge===void 0&&(ge={type:void 0,texture:void 0},pe[ae]=ge),(ge.type!==B||ge.texture!==ne)&&(se!==ae&&(t.activeTexture(ae),se=ae),t.bindTexture(B,ne||q[B]),ge.type=B,ge.texture=ne)}function b(){let B=pe[se];B!==void 0&&B.type!==void 0&&(t.bindTexture(B.type,null),B.type=void 0,B.texture=void 0)}function A(){try{t.compressedTexImage2D(...arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function L(){try{t.compressedTexImage3D(...arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function X(){try{t.texSubImage2D(...arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function j(){try{t.texSubImage3D(...arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function W(){try{t.compressedTexSubImage2D(...arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function Ee(){try{t.compressedTexSubImage3D(...arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function ie(){try{t.texStorage2D(...arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function _e(){try{t.texStorage3D(...arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function Ae(){try{t.texImage2D(...arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function te(){try{t.texImage3D(...arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function he(B){rt.equals(B)===!1&&(t.scissor(B.x,B.y,B.z,B.w),rt.copy(B))}function Re(B){ht.equals(B)===!1&&(t.viewport(B.x,B.y,B.z,B.w),ht.copy(B))}function Se(B,ne){let ae=c.get(ne);ae===void 0&&(ae=new WeakMap,c.set(ne,ae));let ge=ae.get(B);ge===void 0&&(ge=t.getUniformBlockIndex(ne,B.name),ae.set(B,ge))}function ue(B,ne){let ge=c.get(ne).get(B);l.get(ne)!==ge&&(t.uniformBlockBinding(ne,ge,B.__bindingPointIndex),l.set(ne,ge))}function Oe(){t.disable(t.BLEND),t.disable(t.CULL_FACE),t.disable(t.DEPTH_TEST),t.disable(t.POLYGON_OFFSET_FILL),t.disable(t.SCISSOR_TEST),t.disable(t.STENCIL_TEST),t.disable(t.SAMPLE_ALPHA_TO_COVERAGE),t.blendEquation(t.FUNC_ADD),t.blendFunc(t.ONE,t.ZERO),t.blendFuncSeparate(t.ONE,t.ZERO,t.ONE,t.ZERO),t.blendColor(0,0,0,0),t.colorMask(!0,!0,!0,!0),t.clearColor(0,0,0,0),t.depthMask(!0),t.depthFunc(t.LESS),a.setReversed(!1),t.clearDepth(1),t.stencilMask(4294967295),t.stencilFunc(t.ALWAYS,0,4294967295),t.stencilOp(t.KEEP,t.KEEP,t.KEEP),t.clearStencil(0),t.cullFace(t.BACK),t.frontFace(t.CCW),t.polygonOffset(0,0),t.activeTexture(t.TEXTURE0),t.bindFramebuffer(t.FRAMEBUFFER,null),t.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),t.bindFramebuffer(t.READ_FRAMEBUFFER,null),t.useProgram(null),t.lineWidth(1),t.scissor(0,0,t.canvas.width,t.canvas.height),t.viewport(0,0,t.canvas.width,t.canvas.height),f={},se=null,pe={},p={},h=new WeakMap,d=[],y=null,_=!1,m=null,u=null,g=null,v=null,x=null,T=null,C=null,w=new qe(0,0,0),D=0,E=!1,M=null,U=null,G=null,V=null,Y=null,rt.set(0,0,t.canvas.width,t.canvas.height),ht.set(0,0,t.canvas.width,t.canvas.height),r.reset(),a.reset(),o.reset()}return{buffers:{color:r,depth:a,stencil:o},enable:K,disable:oe,bindFramebuffer:Te,drawBuffers:ve,useProgram:ke,setBlending:$e,setMaterial:Be,setFlipSided:le,setCullFace:re,setLineWidth:Ze,setPolygonOffset:de,setScissorTest:Ie,activeTexture:Nt,bindTexture:It,unbindTexture:b,compressedTexImage2D:A,compressedTexImage3D:L,texImage2D:Ae,texImage3D:te,updateUBOMapping:Se,uniformBlockBinding:ue,texStorage2D:ie,texStorage3D:_e,texSubImage2D:X,texSubImage3D:j,compressedTexSubImage2D:W,compressedTexSubImage3D:Ee,scissor:he,viewport:Re,reset:Oe}}function $C(t,e,n,i,s,r,a){let o=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Le,f=new WeakMap,p,h=new WeakMap,d=!1;try{d=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function y(b,A){return d?new OffscreenCanvas(b,A):Cl("canvas")}function _(b,A,L){let X=1,j=It(b);if((j.width>L||j.height>L)&&(X=L/Math.max(j.width,j.height)),X<1)if(typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&b instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&b instanceof ImageBitmap||typeof VideoFrame<"u"&&b instanceof VideoFrame){let W=Math.floor(X*j.width),Ee=Math.floor(X*j.height);p===void 0&&(p=y(W,Ee));let ie=A?y(W,Ee):p;return ie.width=W,ie.height=Ee,ie.getContext("2d").drawImage(b,0,0,W,Ee),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+j.width+"x"+j.height+") to ("+W+"x"+Ee+")."),ie}else return"data"in b&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+j.width+"x"+j.height+")."),b;return b}function m(b){return b.generateMipmaps}function u(b){t.generateMipmap(b)}function g(b){return b.isWebGLCubeRenderTarget?t.TEXTURE_CUBE_MAP:b.isWebGL3DRenderTarget?t.TEXTURE_3D:b.isWebGLArrayRenderTarget||b.isCompressedArrayTexture?t.TEXTURE_2D_ARRAY:t.TEXTURE_2D}function v(b,A,L,X,j=!1){if(b!==null){if(t[b]!==void 0)return t[b];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+b+"'")}let W=A;if(A===t.RED&&(L===t.FLOAT&&(W=t.R32F),L===t.HALF_FLOAT&&(W=t.R16F),L===t.UNSIGNED_BYTE&&(W=t.R8)),A===t.RED_INTEGER&&(L===t.UNSIGNED_BYTE&&(W=t.R8UI),L===t.UNSIGNED_SHORT&&(W=t.R16UI),L===t.UNSIGNED_INT&&(W=t.R32UI),L===t.BYTE&&(W=t.R8I),L===t.SHORT&&(W=t.R16I),L===t.INT&&(W=t.R32I)),A===t.RG&&(L===t.FLOAT&&(W=t.RG32F),L===t.HALF_FLOAT&&(W=t.RG16F),L===t.UNSIGNED_BYTE&&(W=t.RG8)),A===t.RG_INTEGER&&(L===t.UNSIGNED_BYTE&&(W=t.RG8UI),L===t.UNSIGNED_SHORT&&(W=t.RG16UI),L===t.UNSIGNED_INT&&(W=t.RG32UI),L===t.BYTE&&(W=t.RG8I),L===t.SHORT&&(W=t.RG16I),L===t.INT&&(W=t.RG32I)),A===t.RGB_INTEGER&&(L===t.UNSIGNED_BYTE&&(W=t.RGB8UI),L===t.UNSIGNED_SHORT&&(W=t.RGB16UI),L===t.UNSIGNED_INT&&(W=t.RGB32UI),L===t.BYTE&&(W=t.RGB8I),L===t.SHORT&&(W=t.RGB16I),L===t.INT&&(W=t.RGB32I)),A===t.RGBA_INTEGER&&(L===t.UNSIGNED_BYTE&&(W=t.RGBA8UI),L===t.UNSIGNED_SHORT&&(W=t.RGBA16UI),L===t.UNSIGNED_INT&&(W=t.RGBA32UI),L===t.BYTE&&(W=t.RGBA8I),L===t.SHORT&&(W=t.RGBA16I),L===t.INT&&(W=t.RGBA32I)),A===t.RGB&&(L===t.UNSIGNED_INT_5_9_9_9_REV&&(W=t.RGB9_E5),L===t.UNSIGNED_INT_10F_11F_11F_REV&&(W=t.R11F_G11F_B10F)),A===t.RGBA){let Ee=j?bl:je.getTransfer(X);L===t.FLOAT&&(W=t.RGBA32F),L===t.HALF_FLOAT&&(W=t.RGBA16F),L===t.UNSIGNED_BYTE&&(W=Ee===lt?t.SRGB8_ALPHA8:t.RGBA8),L===t.UNSIGNED_SHORT_4_4_4_4&&(W=t.RGBA4),L===t.UNSIGNED_SHORT_5_5_5_1&&(W=t.RGB5_A1)}return(W===t.R16F||W===t.R32F||W===t.RG16F||W===t.RG32F||W===t.RGBA16F||W===t.RGBA32F)&&e.get("EXT_color_buffer_float"),W}function x(b,A){let L;return b?A===null||A===$s||A===er?L=t.DEPTH24_STENCIL8:A===li?L=t.DEPTH32F_STENCIL8:A===ro&&(L=t.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):A===null||A===$s||A===er?L=t.DEPTH_COMPONENT24:A===li?L=t.DEPTH_COMPONENT32F:A===ro&&(L=t.DEPTH_COMPONENT16),L}function T(b,A){return m(b)===!0||b.isFramebufferTexture&&b.minFilter!==ai&&b.minFilter!==Ht?Math.log2(Math.max(A.width,A.height))+1:b.mipmaps!==void 0&&b.mipmaps.length>0?b.mipmaps.length:b.isCompressedTexture&&Array.isArray(b.image)?A.mipmaps.length:1}function C(b){let A=b.target;A.removeEventListener("dispose",C),D(A),A.isVideoTexture&&f.delete(A)}function w(b){let A=b.target;A.removeEventListener("dispose",w),M(A)}function D(b){let A=i.get(b);if(A.__webglInit===void 0)return;let L=b.source,X=h.get(L);if(X){let j=X[A.__cacheKey];j.usedTimes--,j.usedTimes===0&&E(b),Object.keys(X).length===0&&h.delete(L)}i.remove(b)}function E(b){let A=i.get(b);t.deleteTexture(A.__webglTexture);let L=b.source,X=h.get(L);delete X[A.__cacheKey],a.memory.textures--}function M(b){let A=i.get(b);if(b.depthTexture&&(b.depthTexture.dispose(),i.remove(b.depthTexture)),b.isWebGLCubeRenderTarget)for(let X=0;X<6;X++){if(Array.isArray(A.__webglFramebuffer[X]))for(let j=0;j<A.__webglFramebuffer[X].length;j++)t.deleteFramebuffer(A.__webglFramebuffer[X][j]);else t.deleteFramebuffer(A.__webglFramebuffer[X]);A.__webglDepthbuffer&&t.deleteRenderbuffer(A.__webglDepthbuffer[X])}else{if(Array.isArray(A.__webglFramebuffer))for(let X=0;X<A.__webglFramebuffer.length;X++)t.deleteFramebuffer(A.__webglFramebuffer[X]);else t.deleteFramebuffer(A.__webglFramebuffer);if(A.__webglDepthbuffer&&t.deleteRenderbuffer(A.__webglDepthbuffer),A.__webglMultisampledFramebuffer&&t.deleteFramebuffer(A.__webglMultisampledFramebuffer),A.__webglColorRenderbuffer)for(let X=0;X<A.__webglColorRenderbuffer.length;X++)A.__webglColorRenderbuffer[X]&&t.deleteRenderbuffer(A.__webglColorRenderbuffer[X]);A.__webglDepthRenderbuffer&&t.deleteRenderbuffer(A.__webglDepthRenderbuffer)}let L=b.textures;for(let X=0,j=L.length;X<j;X++){let W=i.get(L[X]);W.__webglTexture&&(t.deleteTexture(W.__webglTexture),a.memory.textures--),i.remove(L[X])}i.remove(b)}let U=0;function G(){U=0}function V(){let b=U;return b>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+b+" texture units while this GPU supports only "+s.maxTextures),U+=1,b}function Y(b){let A=[];return A.push(b.wrapS),A.push(b.wrapT),A.push(b.wrapR||0),A.push(b.magFilter),A.push(b.minFilter),A.push(b.anisotropy),A.push(b.internalFormat),A.push(b.format),A.push(b.type),A.push(b.generateMipmaps),A.push(b.premultiplyAlpha),A.push(b.flipY),A.push(b.unpackAlignment),A.push(b.colorSpace),A.join()}function O(b,A){let L=i.get(b);if(b.isVideoTexture&&Ie(b),b.isRenderTargetTexture===!1&&b.isExternalTexture!==!0&&b.version>0&&L.__version!==b.version){let X=b.image;if(X===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(X.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{q(L,b,A);return}}else b.isExternalTexture&&(L.__webglTexture=b.sourceTexture?b.sourceTexture:null);n.bindTexture(t.TEXTURE_2D,L.__webglTexture,t.TEXTURE0+A)}function N(b,A){let L=i.get(b);if(b.isRenderTargetTexture===!1&&b.version>0&&L.__version!==b.version){q(L,b,A);return}n.bindTexture(t.TEXTURE_2D_ARRAY,L.__webglTexture,t.TEXTURE0+A)}function J(b,A){let L=i.get(b);if(b.isRenderTargetTexture===!1&&b.version>0&&L.__version!==b.version){q(L,b,A);return}n.bindTexture(t.TEXTURE_3D,L.__webglTexture,t.TEXTURE0+A)}function k(b,A){let L=i.get(b);if(b.version>0&&L.__version!==b.version){K(L,b,A);return}n.bindTexture(t.TEXTURE_CUBE_MAP,L.__webglTexture,t.TEXTURE0+A)}let se={[Yu]:t.REPEAT,[Xs]:t.CLAMP_TO_EDGE,[qu]:t.MIRRORED_REPEAT},pe={[ai]:t.NEAREST,[J_]:t.NEAREST_MIPMAP_NEAREST,[Gl]:t.NEAREST_MIPMAP_LINEAR,[Ht]:t.LINEAR,[Mf]:t.LINEAR_MIPMAP_NEAREST,[js]:t.LINEAR_MIPMAP_LINEAR},Me={[tA]:t.NEVER,[oA]:t.ALWAYS,[nA]:t.LESS,[zm]:t.LEQUAL,[iA]:t.EQUAL,[aA]:t.GEQUAL,[sA]:t.GREATER,[rA]:t.NOTEQUAL};function Fe(b,A){if(A.type===li&&e.has("OES_texture_float_linear")===!1&&(A.magFilter===Ht||A.magFilter===Mf||A.magFilter===Gl||A.magFilter===js||A.minFilter===Ht||A.minFilter===Mf||A.minFilter===Gl||A.minFilter===js)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),t.texParameteri(b,t.TEXTURE_WRAP_S,se[A.wrapS]),t.texParameteri(b,t.TEXTURE_WRAP_T,se[A.wrapT]),(b===t.TEXTURE_3D||b===t.TEXTURE_2D_ARRAY)&&t.texParameteri(b,t.TEXTURE_WRAP_R,se[A.wrapR]),t.texParameteri(b,t.TEXTURE_MAG_FILTER,pe[A.magFilter]),t.texParameteri(b,t.TEXTURE_MIN_FILTER,pe[A.minFilter]),A.compareFunction&&(t.texParameteri(b,t.TEXTURE_COMPARE_MODE,t.COMPARE_REF_TO_TEXTURE),t.texParameteri(b,t.TEXTURE_COMPARE_FUNC,Me[A.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(A.magFilter===ai||A.minFilter!==Gl&&A.minFilter!==js||A.type===li&&e.has("OES_texture_float_linear")===!1)return;if(A.anisotropy>1||i.get(A).__currentAnisotropy){let L=e.get("EXT_texture_filter_anisotropic");t.texParameterf(b,L.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(A.anisotropy,s.getMaxAnisotropy())),i.get(A).__currentAnisotropy=A.anisotropy}}}function rt(b,A){let L=!1;b.__webglInit===void 0&&(b.__webglInit=!0,A.addEventListener("dispose",C));let X=A.source,j=h.get(X);j===void 0&&(j={},h.set(X,j));let W=Y(A);if(W!==b.__cacheKey){j[W]===void 0&&(j[W]={texture:t.createTexture(),usedTimes:0},a.memory.textures++,L=!0),j[W].usedTimes++;let Ee=j[b.__cacheKey];Ee!==void 0&&(j[b.__cacheKey].usedTimes--,Ee.usedTimes===0&&E(A)),b.__cacheKey=W,b.__webglTexture=j[W].texture}return L}function ht(b,A,L){return Math.floor(Math.floor(b/L)/A)}function Je(b,A,L,X){let W=b.updateRanges;if(W.length===0)n.texSubImage2D(t.TEXTURE_2D,0,0,0,A.width,A.height,L,X,A.data);else{W.sort((te,he)=>te.start-he.start);let Ee=0;for(let te=1;te<W.length;te++){let he=W[Ee],Re=W[te],Se=he.start+he.count,ue=ht(Re.start,A.width,4),Oe=ht(he.start,A.width,4);Re.start<=Se+1&&ue===Oe&&ht(Re.start+Re.count-1,A.width,4)===ue?he.count=Math.max(he.count,Re.start+Re.count-he.start):(++Ee,W[Ee]=Re)}W.length=Ee+1;let ie=t.getParameter(t.UNPACK_ROW_LENGTH),_e=t.getParameter(t.UNPACK_SKIP_PIXELS),Ae=t.getParameter(t.UNPACK_SKIP_ROWS);t.pixelStorei(t.UNPACK_ROW_LENGTH,A.width);for(let te=0,he=W.length;te<he;te++){let Re=W[te],Se=Math.floor(Re.start/4),ue=Math.ceil(Re.count/4),Oe=Se%A.width,B=Math.floor(Se/A.width),ne=ue,ae=1;t.pixelStorei(t.UNPACK_SKIP_PIXELS,Oe),t.pixelStorei(t.UNPACK_SKIP_ROWS,B),n.texSubImage2D(t.TEXTURE_2D,0,Oe,B,ne,ae,L,X,A.data)}b.clearUpdateRanges(),t.pixelStorei(t.UNPACK_ROW_LENGTH,ie),t.pixelStorei(t.UNPACK_SKIP_PIXELS,_e),t.pixelStorei(t.UNPACK_SKIP_ROWS,Ae)}}function q(b,A,L){let X=t.TEXTURE_2D;(A.isDataArrayTexture||A.isCompressedArrayTexture)&&(X=t.TEXTURE_2D_ARRAY),A.isData3DTexture&&(X=t.TEXTURE_3D);let j=rt(b,A),W=A.source;n.bindTexture(X,b.__webglTexture,t.TEXTURE0+L);let Ee=i.get(W);if(W.version!==Ee.__version||j===!0){n.activeTexture(t.TEXTURE0+L);let ie=je.getPrimaries(je.workingColorSpace),_e=A.colorSpace===Yn?null:je.getPrimaries(A.colorSpace),Ae=A.colorSpace===Yn||ie===_e?t.NONE:t.BROWSER_DEFAULT_WEBGL;t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,A.flipY),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,A.premultiplyAlpha),t.pixelStorei(t.UNPACK_ALIGNMENT,A.unpackAlignment),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,Ae);let te=_(A.image,!1,s.maxTextureSize);te=Nt(A,te);let he=r.convert(A.format,A.colorSpace),Re=r.convert(A.type),Se=v(A.internalFormat,he,Re,A.colorSpace,A.isVideoTexture);Fe(X,A);let ue,Oe=A.mipmaps,B=A.isVideoTexture!==!0,ne=Ee.__version===void 0||j===!0,ae=W.dataReady,ge=T(A,te);if(A.isDepthTexture)Se=x(A.format===tr,A.type),ne&&(B?n.texStorage2D(t.TEXTURE_2D,1,Se,te.width,te.height):n.texImage2D(t.TEXTURE_2D,0,Se,te.width,te.height,0,he,Re,null));else if(A.isDataTexture)if(Oe.length>0){B&&ne&&n.texStorage2D(t.TEXTURE_2D,ge,Se,Oe[0].width,Oe[0].height);for(let $=0,Z=Oe.length;$<Z;$++)ue=Oe[$],B?ae&&n.texSubImage2D(t.TEXTURE_2D,$,0,0,ue.width,ue.height,he,Re,ue.data):n.texImage2D(t.TEXTURE_2D,$,Se,ue.width,ue.height,0,he,Re,ue.data);A.generateMipmaps=!1}else B?(ne&&n.texStorage2D(t.TEXTURE_2D,ge,Se,te.width,te.height),ae&&Je(A,te,he,Re)):n.texImage2D(t.TEXTURE_2D,0,Se,te.width,te.height,0,he,Re,te.data);else if(A.isCompressedTexture)if(A.isCompressedArrayTexture){B&&ne&&n.texStorage3D(t.TEXTURE_2D_ARRAY,ge,Se,Oe[0].width,Oe[0].height,te.depth);for(let $=0,Z=Oe.length;$<Z;$++)if(ue=Oe[$],A.format!==ci)if(he!==null)if(B){if(ae)if(A.layerUpdates.size>0){let ye=Wm(ue.width,ue.height,A.format,A.type);for(let Pe of A.layerUpdates){let mt=ue.data.subarray(Pe*ye/ue.data.BYTES_PER_ELEMENT,(Pe+1)*ye/ue.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,$,0,0,Pe,ue.width,ue.height,1,he,mt)}A.clearLayerUpdates()}else n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,$,0,0,0,ue.width,ue.height,te.depth,he,ue.data)}else n.compressedTexImage3D(t.TEXTURE_2D_ARRAY,$,Se,ue.width,ue.height,te.depth,0,ue.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else B?ae&&n.texSubImage3D(t.TEXTURE_2D_ARRAY,$,0,0,0,ue.width,ue.height,te.depth,he,Re,ue.data):n.texImage3D(t.TEXTURE_2D_ARRAY,$,Se,ue.width,ue.height,te.depth,0,he,Re,ue.data)}else{B&&ne&&n.texStorage2D(t.TEXTURE_2D,ge,Se,Oe[0].width,Oe[0].height);for(let $=0,Z=Oe.length;$<Z;$++)ue=Oe[$],A.format!==ci?he!==null?B?ae&&n.compressedTexSubImage2D(t.TEXTURE_2D,$,0,0,ue.width,ue.height,he,ue.data):n.compressedTexImage2D(t.TEXTURE_2D,$,Se,ue.width,ue.height,0,ue.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):B?ae&&n.texSubImage2D(t.TEXTURE_2D,$,0,0,ue.width,ue.height,he,Re,ue.data):n.texImage2D(t.TEXTURE_2D,$,Se,ue.width,ue.height,0,he,Re,ue.data)}else if(A.isDataArrayTexture)if(B){if(ne&&n.texStorage3D(t.TEXTURE_2D_ARRAY,ge,Se,te.width,te.height,te.depth),ae)if(A.layerUpdates.size>0){let $=Wm(te.width,te.height,A.format,A.type);for(let Z of A.layerUpdates){let ye=te.data.subarray(Z*$/te.data.BYTES_PER_ELEMENT,(Z+1)*$/te.data.BYTES_PER_ELEMENT);n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,Z,te.width,te.height,1,he,Re,ye)}A.clearLayerUpdates()}else n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,0,te.width,te.height,te.depth,he,Re,te.data)}else n.texImage3D(t.TEXTURE_2D_ARRAY,0,Se,te.width,te.height,te.depth,0,he,Re,te.data);else if(A.isData3DTexture)B?(ne&&n.texStorage3D(t.TEXTURE_3D,ge,Se,te.width,te.height,te.depth),ae&&n.texSubImage3D(t.TEXTURE_3D,0,0,0,0,te.width,te.height,te.depth,he,Re,te.data)):n.texImage3D(t.TEXTURE_3D,0,Se,te.width,te.height,te.depth,0,he,Re,te.data);else if(A.isFramebufferTexture){if(ne)if(B)n.texStorage2D(t.TEXTURE_2D,ge,Se,te.width,te.height);else{let $=te.width,Z=te.height;for(let ye=0;ye<ge;ye++)n.texImage2D(t.TEXTURE_2D,ye,Se,$,Z,0,he,Re,null),$>>=1,Z>>=1}}else if(Oe.length>0){if(B&&ne){let $=It(Oe[0]);n.texStorage2D(t.TEXTURE_2D,ge,Se,$.width,$.height)}for(let $=0,Z=Oe.length;$<Z;$++)ue=Oe[$],B?ae&&n.texSubImage2D(t.TEXTURE_2D,$,0,0,he,Re,ue):n.texImage2D(t.TEXTURE_2D,$,Se,he,Re,ue);A.generateMipmaps=!1}else if(B){if(ne){let $=It(te);n.texStorage2D(t.TEXTURE_2D,ge,Se,$.width,$.height)}ae&&n.texSubImage2D(t.TEXTURE_2D,0,0,0,he,Re,te)}else n.texImage2D(t.TEXTURE_2D,0,Se,he,Re,te);m(A)&&u(X),Ee.__version=W.version,A.onUpdate&&A.onUpdate(A)}b.__version=A.version}function K(b,A,L){if(A.image.length!==6)return;let X=rt(b,A),j=A.source;n.bindTexture(t.TEXTURE_CUBE_MAP,b.__webglTexture,t.TEXTURE0+L);let W=i.get(j);if(j.version!==W.__version||X===!0){n.activeTexture(t.TEXTURE0+L);let Ee=je.getPrimaries(je.workingColorSpace),ie=A.colorSpace===Yn?null:je.getPrimaries(A.colorSpace),_e=A.colorSpace===Yn||Ee===ie?t.NONE:t.BROWSER_DEFAULT_WEBGL;t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,A.flipY),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,A.premultiplyAlpha),t.pixelStorei(t.UNPACK_ALIGNMENT,A.unpackAlignment),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,_e);let Ae=A.isCompressedTexture||A.image[0].isCompressedTexture,te=A.image[0]&&A.image[0].isDataTexture,he=[];for(let Z=0;Z<6;Z++)!Ae&&!te?he[Z]=_(A.image[Z],!0,s.maxCubemapSize):he[Z]=te?A.image[Z].image:A.image[Z],he[Z]=Nt(A,he[Z]);let Re=he[0],Se=r.convert(A.format,A.colorSpace),ue=r.convert(A.type),Oe=v(A.internalFormat,Se,ue,A.colorSpace),B=A.isVideoTexture!==!0,ne=W.__version===void 0||X===!0,ae=j.dataReady,ge=T(A,Re);Fe(t.TEXTURE_CUBE_MAP,A);let $;if(Ae){B&&ne&&n.texStorage2D(t.TEXTURE_CUBE_MAP,ge,Oe,Re.width,Re.height);for(let Z=0;Z<6;Z++){$=he[Z].mipmaps;for(let ye=0;ye<$.length;ye++){let Pe=$[ye];A.format!==ci?Se!==null?B?ae&&n.compressedTexSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,ye,0,0,Pe.width,Pe.height,Se,Pe.data):n.compressedTexImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,ye,Oe,Pe.width,Pe.height,0,Pe.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):B?ae&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,ye,0,0,Pe.width,Pe.height,Se,ue,Pe.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,ye,Oe,Pe.width,Pe.height,0,Se,ue,Pe.data)}}}else{if($=A.mipmaps,B&&ne){$.length>0&&ge++;let Z=It(he[0]);n.texStorage2D(t.TEXTURE_CUBE_MAP,ge,Oe,Z.width,Z.height)}for(let Z=0;Z<6;Z++)if(te){B?ae&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,0,0,0,he[Z].width,he[Z].height,Se,ue,he[Z].data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,0,Oe,he[Z].width,he[Z].height,0,Se,ue,he[Z].data);for(let ye=0;ye<$.length;ye++){let mt=$[ye].image[Z].image;B?ae&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,ye+1,0,0,mt.width,mt.height,Se,ue,mt.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,ye+1,Oe,mt.width,mt.height,0,Se,ue,mt.data)}}else{B?ae&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,0,0,0,Se,ue,he[Z]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,0,Oe,Se,ue,he[Z]);for(let ye=0;ye<$.length;ye++){let Pe=$[ye];B?ae&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,ye+1,0,0,Se,ue,Pe.image[Z]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,ye+1,Oe,Se,ue,Pe.image[Z])}}}m(A)&&u(t.TEXTURE_CUBE_MAP),W.__version=j.version,A.onUpdate&&A.onUpdate(A)}b.__version=A.version}function oe(b,A,L,X,j,W){let Ee=r.convert(L.format,L.colorSpace),ie=r.convert(L.type),_e=v(L.internalFormat,Ee,ie,L.colorSpace),Ae=i.get(A),te=i.get(L);if(te.__renderTarget=A,!Ae.__hasExternalTextures){let he=Math.max(1,A.width>>W),Re=Math.max(1,A.height>>W);j===t.TEXTURE_3D||j===t.TEXTURE_2D_ARRAY?n.texImage3D(j,W,_e,he,Re,A.depth,0,Ee,ie,null):n.texImage2D(j,W,_e,he,Re,0,Ee,ie,null)}n.bindFramebuffer(t.FRAMEBUFFER,b),de(A)?o.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,X,j,te.__webglTexture,0,Ze(A)):(j===t.TEXTURE_2D||j>=t.TEXTURE_CUBE_MAP_POSITIVE_X&&j<=t.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&t.framebufferTexture2D(t.FRAMEBUFFER,X,j,te.__webglTexture,W),n.bindFramebuffer(t.FRAMEBUFFER,null)}function Te(b,A,L){if(t.bindRenderbuffer(t.RENDERBUFFER,b),A.depthBuffer){let X=A.depthTexture,j=X&&X.isDepthTexture?X.type:null,W=x(A.stencilBuffer,j),Ee=A.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,ie=Ze(A);de(A)?o.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,ie,W,A.width,A.height):L?t.renderbufferStorageMultisample(t.RENDERBUFFER,ie,W,A.width,A.height):t.renderbufferStorage(t.RENDERBUFFER,W,A.width,A.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,Ee,t.RENDERBUFFER,b)}else{let X=A.textures;for(let j=0;j<X.length;j++){let W=X[j],Ee=r.convert(W.format,W.colorSpace),ie=r.convert(W.type),_e=v(W.internalFormat,Ee,ie,W.colorSpace),Ae=Ze(A);L&&de(A)===!1?t.renderbufferStorageMultisample(t.RENDERBUFFER,Ae,_e,A.width,A.height):de(A)?o.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,Ae,_e,A.width,A.height):t.renderbufferStorage(t.RENDERBUFFER,_e,A.width,A.height)}}t.bindRenderbuffer(t.RENDERBUFFER,null)}function ve(b,A){if(A&&A.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(n.bindFramebuffer(t.FRAMEBUFFER,b),!(A.depthTexture&&A.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let X=i.get(A.depthTexture);X.__renderTarget=A,(!X.__webglTexture||A.depthTexture.image.width!==A.width||A.depthTexture.image.height!==A.height)&&(A.depthTexture.image.width=A.width,A.depthTexture.image.height=A.height,A.depthTexture.needsUpdate=!0),O(A.depthTexture,0);let j=X.__webglTexture,W=Ze(A);if(A.depthTexture.format===ja)de(A)?o.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,t.DEPTH_ATTACHMENT,t.TEXTURE_2D,j,0,W):t.framebufferTexture2D(t.FRAMEBUFFER,t.DEPTH_ATTACHMENT,t.TEXTURE_2D,j,0);else if(A.depthTexture.format===tr)de(A)?o.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,t.DEPTH_STENCIL_ATTACHMENT,t.TEXTURE_2D,j,0,W):t.framebufferTexture2D(t.FRAMEBUFFER,t.DEPTH_STENCIL_ATTACHMENT,t.TEXTURE_2D,j,0);else throw new Error("Unknown depthTexture format")}function ke(b){let A=i.get(b),L=b.isWebGLCubeRenderTarget===!0;if(A.__boundDepthTexture!==b.depthTexture){let X=b.depthTexture;if(A.__depthDisposeCallback&&A.__depthDisposeCallback(),X){let j=()=>{delete A.__boundDepthTexture,delete A.__depthDisposeCallback,X.removeEventListener("dispose",j)};X.addEventListener("dispose",j),A.__depthDisposeCallback=j}A.__boundDepthTexture=X}if(b.depthTexture&&!A.__autoAllocateDepthBuffer){if(L)throw new Error("target.depthTexture not supported in Cube render targets");let X=b.texture.mipmaps;X&&X.length>0?ve(A.__webglFramebuffer[0],b):ve(A.__webglFramebuffer,b)}else if(L){A.__webglDepthbuffer=[];for(let X=0;X<6;X++)if(n.bindFramebuffer(t.FRAMEBUFFER,A.__webglFramebuffer[X]),A.__webglDepthbuffer[X]===void 0)A.__webglDepthbuffer[X]=t.createRenderbuffer(),Te(A.__webglDepthbuffer[X],b,!1);else{let j=b.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,W=A.__webglDepthbuffer[X];t.bindRenderbuffer(t.RENDERBUFFER,W),t.framebufferRenderbuffer(t.FRAMEBUFFER,j,t.RENDERBUFFER,W)}}else{let X=b.texture.mipmaps;if(X&&X.length>0?n.bindFramebuffer(t.FRAMEBUFFER,A.__webglFramebuffer[0]):n.bindFramebuffer(t.FRAMEBUFFER,A.__webglFramebuffer),A.__webglDepthbuffer===void 0)A.__webglDepthbuffer=t.createRenderbuffer(),Te(A.__webglDepthbuffer,b,!1);else{let j=b.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,W=A.__webglDepthbuffer;t.bindRenderbuffer(t.RENDERBUFFER,W),t.framebufferRenderbuffer(t.FRAMEBUFFER,j,t.RENDERBUFFER,W)}}n.bindFramebuffer(t.FRAMEBUFFER,null)}function Jt(b,A,L){let X=i.get(b);A!==void 0&&oe(X.__webglFramebuffer,b,b.texture,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,0),L!==void 0&&ke(b)}function R(b){let A=b.texture,L=i.get(b),X=i.get(A);b.addEventListener("dispose",w);let j=b.textures,W=b.isWebGLCubeRenderTarget===!0,Ee=j.length>1;if(Ee||(X.__webglTexture===void 0&&(X.__webglTexture=t.createTexture()),X.__version=A.version,a.memory.textures++),W){L.__webglFramebuffer=[];for(let ie=0;ie<6;ie++)if(A.mipmaps&&A.mipmaps.length>0){L.__webglFramebuffer[ie]=[];for(let _e=0;_e<A.mipmaps.length;_e++)L.__webglFramebuffer[ie][_e]=t.createFramebuffer()}else L.__webglFramebuffer[ie]=t.createFramebuffer()}else{if(A.mipmaps&&A.mipmaps.length>0){L.__webglFramebuffer=[];for(let ie=0;ie<A.mipmaps.length;ie++)L.__webglFramebuffer[ie]=t.createFramebuffer()}else L.__webglFramebuffer=t.createFramebuffer();if(Ee)for(let ie=0,_e=j.length;ie<_e;ie++){let Ae=i.get(j[ie]);Ae.__webglTexture===void 0&&(Ae.__webglTexture=t.createTexture(),a.memory.textures++)}if(b.samples>0&&de(b)===!1){L.__webglMultisampledFramebuffer=t.createFramebuffer(),L.__webglColorRenderbuffer=[],n.bindFramebuffer(t.FRAMEBUFFER,L.__webglMultisampledFramebuffer);for(let ie=0;ie<j.length;ie++){let _e=j[ie];L.__webglColorRenderbuffer[ie]=t.createRenderbuffer(),t.bindRenderbuffer(t.RENDERBUFFER,L.__webglColorRenderbuffer[ie]);let Ae=r.convert(_e.format,_e.colorSpace),te=r.convert(_e.type),he=v(_e.internalFormat,Ae,te,_e.colorSpace,b.isXRRenderTarget===!0),Re=Ze(b);t.renderbufferStorageMultisample(t.RENDERBUFFER,Re,he,b.width,b.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+ie,t.RENDERBUFFER,L.__webglColorRenderbuffer[ie])}t.bindRenderbuffer(t.RENDERBUFFER,null),b.depthBuffer&&(L.__webglDepthRenderbuffer=t.createRenderbuffer(),Te(L.__webglDepthRenderbuffer,b,!0)),n.bindFramebuffer(t.FRAMEBUFFER,null)}}if(W){n.bindTexture(t.TEXTURE_CUBE_MAP,X.__webglTexture),Fe(t.TEXTURE_CUBE_MAP,A);for(let ie=0;ie<6;ie++)if(A.mipmaps&&A.mipmaps.length>0)for(let _e=0;_e<A.mipmaps.length;_e++)oe(L.__webglFramebuffer[ie][_e],b,A,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+ie,_e);else oe(L.__webglFramebuffer[ie],b,A,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+ie,0);m(A)&&u(t.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(Ee){for(let ie=0,_e=j.length;ie<_e;ie++){let Ae=j[ie],te=i.get(Ae),he=t.TEXTURE_2D;(b.isWebGL3DRenderTarget||b.isWebGLArrayRenderTarget)&&(he=b.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(he,te.__webglTexture),Fe(he,Ae),oe(L.__webglFramebuffer,b,Ae,t.COLOR_ATTACHMENT0+ie,he,0),m(Ae)&&u(he)}n.unbindTexture()}else{let ie=t.TEXTURE_2D;if((b.isWebGL3DRenderTarget||b.isWebGLArrayRenderTarget)&&(ie=b.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(ie,X.__webglTexture),Fe(ie,A),A.mipmaps&&A.mipmaps.length>0)for(let _e=0;_e<A.mipmaps.length;_e++)oe(L.__webglFramebuffer[_e],b,A,t.COLOR_ATTACHMENT0,ie,_e);else oe(L.__webglFramebuffer,b,A,t.COLOR_ATTACHMENT0,ie,0);m(A)&&u(ie),n.unbindTexture()}b.depthBuffer&&ke(b)}function $e(b){let A=b.textures;for(let L=0,X=A.length;L<X;L++){let j=A[L];if(m(j)){let W=g(b),Ee=i.get(j).__webglTexture;n.bindTexture(W,Ee),u(W),n.unbindTexture()}}}let Be=[],le=[];function re(b){if(b.samples>0){if(de(b)===!1){let A=b.textures,L=b.width,X=b.height,j=t.COLOR_BUFFER_BIT,W=b.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,Ee=i.get(b),ie=A.length>1;if(ie)for(let Ae=0;Ae<A.length;Ae++)n.bindFramebuffer(t.FRAMEBUFFER,Ee.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Ae,t.RENDERBUFFER,null),n.bindFramebuffer(t.FRAMEBUFFER,Ee.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+Ae,t.TEXTURE_2D,null,0);n.bindFramebuffer(t.READ_FRAMEBUFFER,Ee.__webglMultisampledFramebuffer);let _e=b.texture.mipmaps;_e&&_e.length>0?n.bindFramebuffer(t.DRAW_FRAMEBUFFER,Ee.__webglFramebuffer[0]):n.bindFramebuffer(t.DRAW_FRAMEBUFFER,Ee.__webglFramebuffer);for(let Ae=0;Ae<A.length;Ae++){if(b.resolveDepthBuffer&&(b.depthBuffer&&(j|=t.DEPTH_BUFFER_BIT),b.stencilBuffer&&b.resolveStencilBuffer&&(j|=t.STENCIL_BUFFER_BIT)),ie){t.framebufferRenderbuffer(t.READ_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.RENDERBUFFER,Ee.__webglColorRenderbuffer[Ae]);let te=i.get(A[Ae]).__webglTexture;t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,te,0)}t.blitFramebuffer(0,0,L,X,0,0,L,X,j,t.NEAREST),l===!0&&(Be.length=0,le.length=0,Be.push(t.COLOR_ATTACHMENT0+Ae),b.depthBuffer&&b.resolveDepthBuffer===!1&&(Be.push(W),le.push(W),t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,le)),t.invalidateFramebuffer(t.READ_FRAMEBUFFER,Be))}if(n.bindFramebuffer(t.READ_FRAMEBUFFER,null),n.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),ie)for(let Ae=0;Ae<A.length;Ae++){n.bindFramebuffer(t.FRAMEBUFFER,Ee.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Ae,t.RENDERBUFFER,Ee.__webglColorRenderbuffer[Ae]);let te=i.get(A[Ae]).__webglTexture;n.bindFramebuffer(t.FRAMEBUFFER,Ee.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+Ae,t.TEXTURE_2D,te,0)}n.bindFramebuffer(t.DRAW_FRAMEBUFFER,Ee.__webglMultisampledFramebuffer)}else if(b.depthBuffer&&b.resolveDepthBuffer===!1&&l){let A=b.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,[A])}}}function Ze(b){return Math.min(s.maxSamples,b.samples)}function de(b){let A=i.get(b);return b.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&A.__useRenderToTexture!==!1}function Ie(b){let A=a.render.frame;f.get(b)!==A&&(f.set(b,A),b.update())}function Nt(b,A){let L=b.colorSpace,X=b.format,j=b.type;return b.isCompressedTexture===!0||b.isVideoTexture===!0||L!==xi&&L!==Yn&&(je.getTransfer(L)===lt?(X!==ci||j!==sn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",L)),A}function It(b){return typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement?(c.width=b.naturalWidth||b.width,c.height=b.naturalHeight||b.height):typeof VideoFrame<"u"&&b instanceof VideoFrame?(c.width=b.displayWidth,c.height=b.displayHeight):(c.width=b.width,c.height=b.height),c}this.allocateTextureUnit=V,this.resetTextureUnits=G,this.setTexture2D=O,this.setTexture2DArray=N,this.setTexture3D=J,this.setTextureCube=k,this.rebindTextures=Jt,this.setupRenderTarget=R,this.updateRenderTargetMipmap=$e,this.updateMultisampleRenderTarget=re,this.setupDepthRenderbuffer=ke,this.setupFrameBufferTexture=oe,this.useMultisampledRTT=de}function e2(t,e){function n(i,s=Yn){let r,a=je.getTransfer(s);if(i===sn)return t.UNSIGNED_BYTE;if(i===Tf)return t.UNSIGNED_SHORT_4_4_4_4;if(i===bf)return t.UNSIGNED_SHORT_5_5_5_1;if(i===Im)return t.UNSIGNED_INT_5_9_9_9_REV;if(i===Pm)return t.UNSIGNED_INT_10F_11F_11F_REV;if(i===Um)return t.BYTE;if(i===Bm)return t.SHORT;if(i===ro)return t.UNSIGNED_SHORT;if(i===Ef)return t.INT;if(i===$s)return t.UNSIGNED_INT;if(i===li)return t.FLOAT;if(i===ao)return t.HALF_FLOAT;if(i===Lm)return t.ALPHA;if(i===Nm)return t.RGB;if(i===ci)return t.RGBA;if(i===ja)return t.DEPTH_COMPONENT;if(i===tr)return t.DEPTH_STENCIL;if(i===Om)return t.RED;if(i===wf)return t.RED_INTEGER;if(i===Fm)return t.RG;if(i===Cf)return t.RG_INTEGER;if(i===Rf)return t.RGBA_INTEGER;if(i===kl||i===Vl||i===Wl||i===Xl)if(a===lt)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(i===kl)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===Vl)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===Wl)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===Xl)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(i===kl)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===Vl)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===Wl)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===Xl)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===Df||i===Uf||i===Bf||i===If)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(i===Df)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===Uf)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===Bf)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===If)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===Pf||i===Lf||i===Nf)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(i===Pf||i===Lf)return a===lt?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(i===Nf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(i===Of||i===Ff||i===zf||i===Hf||i===Gf||i===kf||i===Vf||i===Wf||i===Xf||i===Yf||i===qf||i===Qf||i===Zf||i===Kf)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(i===Of)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===Ff)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===zf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===Hf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===Gf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===kf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===Vf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===Wf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===Xf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===Yf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===qf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===Qf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===Zf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===Kf)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Jf||i===jf||i===$f)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(i===Jf)return a===lt?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===jf)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===$f)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===eh||i===th||i===nh||i===ih)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(i===eh)return r.COMPRESSED_RED_RGTC1_EXT;if(i===th)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===nh)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===ih)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===er?t.UNSIGNED_INT_24_8:t[i]!==void 0?t[i]:null}return{convert:n}}var t2=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,n2=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,ig=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,n){if(this.texture===null){let i=new Ol(e.texture);(e.depthNear!==n.depthNear||e.depthFar!==n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){let n=e.cameras[0].viewport,i=new Qt({vertexShader:t2,fragmentShader:n2,uniforms:{depthColor:{value:this.texture},depthWidth:{value:n.z},depthHeight:{value:n.w}}});this.mesh=new mn(new Pr(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},sg=class extends Vn{constructor(e,n){super();let i=this,s=null,r=1,a=null,o="local-floor",l=1,c=null,f=null,p=null,h=null,d=null,y=null,_=typeof XRWebGLBinding<"u",m=new ig,u={},g=n.getContextAttributes(),v=null,x=null,T=[],C=[],w=new Le,D=null,E=new dn;E.viewport=new Bt;let M=new dn;M.viewport=new Bt;let U=[E,M],G=new pf,V=null,Y=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(q){let K=T[q];return K===void 0&&(K=new io,T[q]=K),K.getTargetRaySpace()},this.getControllerGrip=function(q){let K=T[q];return K===void 0&&(K=new io,T[q]=K),K.getGripSpace()},this.getHand=function(q){let K=T[q];return K===void 0&&(K=new io,T[q]=K),K.getHandSpace()};function O(q){let K=C.indexOf(q.inputSource);if(K===-1)return;let oe=T[K];oe!==void 0&&(oe.update(q.inputSource,q.frame,c||a),oe.dispatchEvent({type:q.type,data:q.inputSource}))}function N(){s.removeEventListener("select",O),s.removeEventListener("selectstart",O),s.removeEventListener("selectend",O),s.removeEventListener("squeeze",O),s.removeEventListener("squeezestart",O),s.removeEventListener("squeezeend",O),s.removeEventListener("end",N),s.removeEventListener("inputsourceschange",J);for(let q=0;q<T.length;q++){let K=C[q];K!==null&&(C[q]=null,T[q].disconnect(K))}V=null,Y=null,m.reset();for(let q in u)delete u[q];e.setRenderTarget(v),d=null,h=null,p=null,s=null,x=null,Je.stop(),i.isPresenting=!1,e.setPixelRatio(D),e.setSize(w.width,w.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(q){r=q,i.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(q){o=q,i.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(q){c=q},this.getBaseLayer=function(){return h!==null?h:d},this.getBinding=function(){return p===null&&_&&(p=new XRWebGLBinding(s,n)),p},this.getFrame=function(){return y},this.getSession=function(){return s},this.setSession=async function(q){if(s=q,s!==null){if(v=e.getRenderTarget(),s.addEventListener("select",O),s.addEventListener("selectstart",O),s.addEventListener("selectend",O),s.addEventListener("squeeze",O),s.addEventListener("squeezestart",O),s.addEventListener("squeezeend",O),s.addEventListener("end",N),s.addEventListener("inputsourceschange",J),g.xrCompatible!==!0&&await n.makeXRCompatible(),D=e.getPixelRatio(),e.getSize(w),_&&"createProjectionLayer"in XRWebGLBinding.prototype){let oe=null,Te=null,ve=null;g.depth&&(ve=g.stencil?n.DEPTH24_STENCIL8:n.DEPTH_COMPONENT24,oe=g.stencil?tr:ja,Te=g.stencil?er:$s);let ke={colorFormat:n.RGBA8,depthFormat:ve,scaleFactor:r};p=this.getBinding(),h=p.createProjectionLayer(ke),s.updateRenderState({layers:[h]}),e.setPixelRatio(1),e.setSize(h.textureWidth,h.textureHeight,!1),x=new qt(h.textureWidth,h.textureHeight,{format:ci,type:sn,depthTexture:new cs(h.textureWidth,h.textureHeight,Te,void 0,void 0,void 0,void 0,void 0,void 0,oe),stencilBuffer:g.stencil,colorSpace:e.outputColorSpace,samples:g.antialias?4:0,resolveDepthBuffer:h.ignoreDepthValues===!1,resolveStencilBuffer:h.ignoreDepthValues===!1})}else{let oe={antialias:g.antialias,alpha:!0,depth:g.depth,stencil:g.stencil,framebufferScaleFactor:r};d=new XRWebGLLayer(s,n,oe),s.updateRenderState({baseLayer:d}),e.setPixelRatio(1),e.setSize(d.framebufferWidth,d.framebufferHeight,!1),x=new qt(d.framebufferWidth,d.framebufferHeight,{format:ci,type:sn,colorSpace:e.outputColorSpace,stencilBuffer:g.stencil,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}x.isXRRenderTarget=!0,this.setFoveation(l),c=null,a=await s.requestReferenceSpace(o),Je.setContext(s),Je.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function J(q){for(let K=0;K<q.removed.length;K++){let oe=q.removed[K],Te=C.indexOf(oe);Te>=0&&(C[Te]=null,T[Te].disconnect(oe))}for(let K=0;K<q.added.length;K++){let oe=q.added[K],Te=C.indexOf(oe);if(Te===-1){for(let ke=0;ke<T.length;ke++)if(ke>=C.length){C.push(oe),Te=ke;break}else if(C[ke]===null){C[ke]=oe,Te=ke;break}if(Te===-1)break}let ve=T[Te];ve&&ve.connect(oe)}}let k=new z,se=new z;function pe(q,K,oe){k.setFromMatrixPosition(K.matrixWorld),se.setFromMatrixPosition(oe.matrixWorld);let Te=k.distanceTo(se),ve=K.projectionMatrix.elements,ke=oe.projectionMatrix.elements,Jt=ve[14]/(ve[10]-1),R=ve[14]/(ve[10]+1),$e=(ve[9]+1)/ve[5],Be=(ve[9]-1)/ve[5],le=(ve[8]-1)/ve[0],re=(ke[8]+1)/ke[0],Ze=Jt*le,de=Jt*re,Ie=Te/(-le+re),Nt=Ie*-le;if(K.matrixWorld.decompose(q.position,q.quaternion,q.scale),q.translateX(Nt),q.translateZ(Ie),q.matrixWorld.compose(q.position,q.quaternion,q.scale),q.matrixWorldInverse.copy(q.matrixWorld).invert(),ve[10]===-1)q.projectionMatrix.copy(K.projectionMatrix),q.projectionMatrixInverse.copy(K.projectionMatrixInverse);else{let It=Jt+Ie,b=R+Ie,A=Ze-Nt,L=de+(Te-Nt),X=$e*R/b*It,j=Be*R/b*It;q.projectionMatrix.makePerspective(A,L,X,j,It,b),q.projectionMatrixInverse.copy(q.projectionMatrix).invert()}}function Me(q,K){K===null?q.matrixWorld.copy(q.matrix):q.matrixWorld.multiplyMatrices(K.matrixWorld,q.matrix),q.matrixWorldInverse.copy(q.matrixWorld).invert()}this.updateCamera=function(q){if(s===null)return;let K=q.near,oe=q.far;m.texture!==null&&(m.depthNear>0&&(K=m.depthNear),m.depthFar>0&&(oe=m.depthFar)),G.near=M.near=E.near=K,G.far=M.far=E.far=oe,(V!==G.near||Y!==G.far)&&(s.updateRenderState({depthNear:G.near,depthFar:G.far}),V=G.near,Y=G.far),G.layers.mask=q.layers.mask|6,E.layers.mask=G.layers.mask&3,M.layers.mask=G.layers.mask&5;let Te=q.parent,ve=G.cameras;Me(G,Te);for(let ke=0;ke<ve.length;ke++)Me(ve[ke],Te);ve.length===2?pe(G,E,M):G.projectionMatrix.copy(E.projectionMatrix),Fe(q,G,Te)};function Fe(q,K,oe){oe===null?q.matrix.copy(K.matrixWorld):(q.matrix.copy(oe.matrixWorld),q.matrix.invert(),q.matrix.multiply(K.matrixWorld)),q.matrix.decompose(q.position,q.quaternion,q.scale),q.updateMatrixWorld(!0),q.projectionMatrix.copy(K.projectionMatrix),q.projectionMatrixInverse.copy(K.projectionMatrixInverse),q.isPerspectiveCamera&&(q.fov=Zu*2*Math.atan(1/q.projectionMatrix.elements[5]),q.zoom=1)}this.getCamera=function(){return G},this.getFoveation=function(){if(!(h===null&&d===null))return l},this.setFoveation=function(q){l=q,h!==null&&(h.fixedFoveation=q),d!==null&&d.fixedFoveation!==void 0&&(d.fixedFoveation=q)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(G)},this.getCameraTexture=function(q){return u[q]};let rt=null;function ht(q,K){if(f=K.getViewerPose(c||a),y=K,f!==null){let oe=f.views;d!==null&&(e.setRenderTargetFramebuffer(x,d.framebuffer),e.setRenderTarget(x));let Te=!1;oe.length!==G.cameras.length&&(G.cameras.length=0,Te=!0);for(let R=0;R<oe.length;R++){let $e=oe[R],Be=null;if(d!==null)Be=d.getViewport($e);else{let re=p.getViewSubImage(h,$e);Be=re.viewport,R===0&&(e.setRenderTargetTextures(x,re.colorTexture,re.depthStencilTexture),e.setRenderTarget(x))}let le=U[R];le===void 0&&(le=new dn,le.layers.enable(R),le.viewport=new Bt,U[R]=le),le.matrix.fromArray($e.transform.matrix),le.matrix.decompose(le.position,le.quaternion,le.scale),le.projectionMatrix.fromArray($e.projectionMatrix),le.projectionMatrixInverse.copy(le.projectionMatrix).invert(),le.viewport.set(Be.x,Be.y,Be.width,Be.height),R===0&&(G.matrix.copy(le.matrix),G.matrix.decompose(G.position,G.quaternion,G.scale)),Te===!0&&G.cameras.push(le)}let ve=s.enabledFeatures;if(ve&&ve.includes("depth-sensing")&&s.depthUsage=="gpu-optimized"&&_){p=i.getBinding();let R=p.getDepthInformation(oe[0]);R&&R.isValid&&R.texture&&m.init(R,s.renderState)}if(ve&&ve.includes("camera-access")&&_){e.state.unbindTexture(),p=i.getBinding();for(let R=0;R<oe.length;R++){let $e=oe[R].camera;if($e){let Be=u[$e];Be||(Be=new Ol,u[$e]=Be);let le=p.getCameraImage($e);Be.sourceTexture=le}}}}for(let oe=0;oe<T.length;oe++){let Te=C[oe],ve=T[oe];Te!==null&&ve!==void 0&&ve.update(Te,K,c||a)}rt&&rt(q,K),K.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:K}),y=null}let Je=new NA;Je.setAnimationLoop(ht),this.setAnimationLoop=function(q){rt=q},this.dispose=function(){}}},Hr=new Ii,i2=new Xt;function s2(t,e){function n(m,u){m.matrixAutoUpdate===!0&&m.updateMatrix(),u.value.copy(m.matrix)}function i(m,u){u.color.getRGB(m.fogColor.value,Gm(t)),u.isFog?(m.fogNear.value=u.near,m.fogFar.value=u.far):u.isFogExp2&&(m.fogDensity.value=u.density)}function s(m,u,g,v,x){u.isMeshBasicMaterial||u.isMeshLambertMaterial?r(m,u):u.isMeshToonMaterial?(r(m,u),p(m,u)):u.isMeshPhongMaterial?(r(m,u),f(m,u)):u.isMeshStandardMaterial?(r(m,u),h(m,u),u.isMeshPhysicalMaterial&&d(m,u,x)):u.isMeshMatcapMaterial?(r(m,u),y(m,u)):u.isMeshDepthMaterial?r(m,u):u.isMeshDistanceMaterial?(r(m,u),_(m,u)):u.isMeshNormalMaterial?r(m,u):u.isLineBasicMaterial?(a(m,u),u.isLineDashedMaterial&&o(m,u)):u.isPointsMaterial?l(m,u,g,v):u.isSpriteMaterial?c(m,u):u.isShadowMaterial?(m.color.value.copy(u.color),m.opacity.value=u.opacity):u.isShaderMaterial&&(u.uniformsNeedUpdate=!1)}function r(m,u){m.opacity.value=u.opacity,u.color&&m.diffuse.value.copy(u.color),u.emissive&&m.emissive.value.copy(u.emissive).multiplyScalar(u.emissiveIntensity),u.map&&(m.map.value=u.map,n(u.map,m.mapTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,n(u.alphaMap,m.alphaMapTransform)),u.bumpMap&&(m.bumpMap.value=u.bumpMap,n(u.bumpMap,m.bumpMapTransform),m.bumpScale.value=u.bumpScale,u.side===Gt&&(m.bumpScale.value*=-1)),u.normalMap&&(m.normalMap.value=u.normalMap,n(u.normalMap,m.normalMapTransform),m.normalScale.value.copy(u.normalScale),u.side===Gt&&m.normalScale.value.negate()),u.displacementMap&&(m.displacementMap.value=u.displacementMap,n(u.displacementMap,m.displacementMapTransform),m.displacementScale.value=u.displacementScale,m.displacementBias.value=u.displacementBias),u.emissiveMap&&(m.emissiveMap.value=u.emissiveMap,n(u.emissiveMap,m.emissiveMapTransform)),u.specularMap&&(m.specularMap.value=u.specularMap,n(u.specularMap,m.specularMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest);let g=e.get(u),v=g.envMap,x=g.envMapRotation;v&&(m.envMap.value=v,Hr.copy(x),Hr.x*=-1,Hr.y*=-1,Hr.z*=-1,v.isCubeTexture&&v.isRenderTargetTexture===!1&&(Hr.y*=-1,Hr.z*=-1),m.envMapRotation.value.setFromMatrix4(i2.makeRotationFromEuler(Hr)),m.flipEnvMap.value=v.isCubeTexture&&v.isRenderTargetTexture===!1?-1:1,m.reflectivity.value=u.reflectivity,m.ior.value=u.ior,m.refractionRatio.value=u.refractionRatio),u.lightMap&&(m.lightMap.value=u.lightMap,m.lightMapIntensity.value=u.lightMapIntensity,n(u.lightMap,m.lightMapTransform)),u.aoMap&&(m.aoMap.value=u.aoMap,m.aoMapIntensity.value=u.aoMapIntensity,n(u.aoMap,m.aoMapTransform))}function a(m,u){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,u.map&&(m.map.value=u.map,n(u.map,m.mapTransform))}function o(m,u){m.dashSize.value=u.dashSize,m.totalSize.value=u.dashSize+u.gapSize,m.scale.value=u.scale}function l(m,u,g,v){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,m.size.value=u.size*g,m.scale.value=v*.5,u.map&&(m.map.value=u.map,n(u.map,m.uvTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,n(u.alphaMap,m.alphaMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest)}function c(m,u){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,m.rotation.value=u.rotation,u.map&&(m.map.value=u.map,n(u.map,m.mapTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,n(u.alphaMap,m.alphaMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest)}function f(m,u){m.specular.value.copy(u.specular),m.shininess.value=Math.max(u.shininess,1e-4)}function p(m,u){u.gradientMap&&(m.gradientMap.value=u.gradientMap)}function h(m,u){m.metalness.value=u.metalness,u.metalnessMap&&(m.metalnessMap.value=u.metalnessMap,n(u.metalnessMap,m.metalnessMapTransform)),m.roughness.value=u.roughness,u.roughnessMap&&(m.roughnessMap.value=u.roughnessMap,n(u.roughnessMap,m.roughnessMapTransform)),u.envMap&&(m.envMapIntensity.value=u.envMapIntensity)}function d(m,u,g){m.ior.value=u.ior,u.sheen>0&&(m.sheenColor.value.copy(u.sheenColor).multiplyScalar(u.sheen),m.sheenRoughness.value=u.sheenRoughness,u.sheenColorMap&&(m.sheenColorMap.value=u.sheenColorMap,n(u.sheenColorMap,m.sheenColorMapTransform)),u.sheenRoughnessMap&&(m.sheenRoughnessMap.value=u.sheenRoughnessMap,n(u.sheenRoughnessMap,m.sheenRoughnessMapTransform))),u.clearcoat>0&&(m.clearcoat.value=u.clearcoat,m.clearcoatRoughness.value=u.clearcoatRoughness,u.clearcoatMap&&(m.clearcoatMap.value=u.clearcoatMap,n(u.clearcoatMap,m.clearcoatMapTransform)),u.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=u.clearcoatRoughnessMap,n(u.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),u.clearcoatNormalMap&&(m.clearcoatNormalMap.value=u.clearcoatNormalMap,n(u.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(u.clearcoatNormalScale),u.side===Gt&&m.clearcoatNormalScale.value.negate())),u.dispersion>0&&(m.dispersion.value=u.dispersion),u.iridescence>0&&(m.iridescence.value=u.iridescence,m.iridescenceIOR.value=u.iridescenceIOR,m.iridescenceThicknessMinimum.value=u.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=u.iridescenceThicknessRange[1],u.iridescenceMap&&(m.iridescenceMap.value=u.iridescenceMap,n(u.iridescenceMap,m.iridescenceMapTransform)),u.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=u.iridescenceThicknessMap,n(u.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),u.transmission>0&&(m.transmission.value=u.transmission,m.transmissionSamplerMap.value=g.texture,m.transmissionSamplerSize.value.set(g.width,g.height),u.transmissionMap&&(m.transmissionMap.value=u.transmissionMap,n(u.transmissionMap,m.transmissionMapTransform)),m.thickness.value=u.thickness,u.thicknessMap&&(m.thicknessMap.value=u.thicknessMap,n(u.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=u.attenuationDistance,m.attenuationColor.value.copy(u.attenuationColor)),u.anisotropy>0&&(m.anisotropyVector.value.set(u.anisotropy*Math.cos(u.anisotropyRotation),u.anisotropy*Math.sin(u.anisotropyRotation)),u.anisotropyMap&&(m.anisotropyMap.value=u.anisotropyMap,n(u.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=u.specularIntensity,m.specularColor.value.copy(u.specularColor),u.specularColorMap&&(m.specularColorMap.value=u.specularColorMap,n(u.specularColorMap,m.specularColorMapTransform)),u.specularIntensityMap&&(m.specularIntensityMap.value=u.specularIntensityMap,n(u.specularIntensityMap,m.specularIntensityMapTransform))}function y(m,u){u.matcap&&(m.matcap.value=u.matcap)}function _(m,u){let g=e.get(u).light;m.referencePosition.value.setFromMatrixPosition(g.matrixWorld),m.nearDistance.value=g.shadow.camera.near,m.farDistance.value=g.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:s}}function r2(t,e,n,i){let s={},r={},a=[],o=t.getParameter(t.MAX_UNIFORM_BUFFER_BINDINGS);function l(g,v){let x=v.program;i.uniformBlockBinding(g,x)}function c(g,v){let x=s[g.id];x===void 0&&(y(g),x=f(g),s[g.id]=x,g.addEventListener("dispose",m));let T=v.program;i.updateUBOMapping(g,T);let C=e.render.frame;r[g.id]!==C&&(h(g),r[g.id]=C)}function f(g){let v=p();g.__bindingPointIndex=v;let x=t.createBuffer(),T=g.__size,C=g.usage;return t.bindBuffer(t.UNIFORM_BUFFER,x),t.bufferData(t.UNIFORM_BUFFER,T,C),t.bindBuffer(t.UNIFORM_BUFFER,null),t.bindBufferBase(t.UNIFORM_BUFFER,v,x),x}function p(){for(let g=0;g<o;g++)if(a.indexOf(g)===-1)return a.push(g),g;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function h(g){let v=s[g.id],x=g.uniforms,T=g.__cache;t.bindBuffer(t.UNIFORM_BUFFER,v);for(let C=0,w=x.length;C<w;C++){let D=Array.isArray(x[C])?x[C]:[x[C]];for(let E=0,M=D.length;E<M;E++){let U=D[E];if(d(U,C,E,T)===!0){let G=U.__offset,V=Array.isArray(U.value)?U.value:[U.value],Y=0;for(let O=0;O<V.length;O++){let N=V[O],J=_(N);typeof N=="number"||typeof N=="boolean"?(U.__data[0]=N,t.bufferSubData(t.UNIFORM_BUFFER,G+Y,U.__data)):N.isMatrix3?(U.__data[0]=N.elements[0],U.__data[1]=N.elements[1],U.__data[2]=N.elements[2],U.__data[3]=0,U.__data[4]=N.elements[3],U.__data[5]=N.elements[4],U.__data[6]=N.elements[5],U.__data[7]=0,U.__data[8]=N.elements[6],U.__data[9]=N.elements[7],U.__data[10]=N.elements[8],U.__data[11]=0):(N.toArray(U.__data,Y),Y+=J.storage/Float32Array.BYTES_PER_ELEMENT)}t.bufferSubData(t.UNIFORM_BUFFER,G,U.__data)}}}t.bindBuffer(t.UNIFORM_BUFFER,null)}function d(g,v,x,T){let C=g.value,w=v+"_"+x;if(T[w]===void 0)return typeof C=="number"||typeof C=="boolean"?T[w]=C:T[w]=C.clone(),!0;{let D=T[w];if(typeof C=="number"||typeof C=="boolean"){if(D!==C)return T[w]=C,!0}else if(D.equals(C)===!1)return D.copy(C),!0}return!1}function y(g){let v=g.uniforms,x=0,T=16;for(let w=0,D=v.length;w<D;w++){let E=Array.isArray(v[w])?v[w]:[v[w]];for(let M=0,U=E.length;M<U;M++){let G=E[M],V=Array.isArray(G.value)?G.value:[G.value];for(let Y=0,O=V.length;Y<O;Y++){let N=V[Y],J=_(N),k=x%T,se=k%J.boundary,pe=k+se;x+=se,pe!==0&&T-pe<J.storage&&(x+=T-pe),G.__data=new Float32Array(J.storage/Float32Array.BYTES_PER_ELEMENT),G.__offset=x,x+=J.storage}}}let C=x%T;return C>0&&(x+=T-C),g.__size=x,g.__cache={},this}function _(g){let v={boundary:0,storage:0};return typeof g=="number"||typeof g=="boolean"?(v.boundary=4,v.storage=4):g.isVector2?(v.boundary=8,v.storage=8):g.isVector3||g.isColor?(v.boundary=16,v.storage=12):g.isVector4?(v.boundary=16,v.storage=16):g.isMatrix3?(v.boundary=48,v.storage=48):g.isMatrix4?(v.boundary=64,v.storage=64):g.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",g),v}function m(g){let v=g.target;v.removeEventListener("dispose",m);let x=a.indexOf(v.__bindingPointIndex);a.splice(x,1),t.deleteBuffer(s[v.id]),delete s[v.id],delete r[v.id]}function u(){for(let g in s)t.deleteBuffer(s[g]);a=[],s={},r={}}return{bind:l,update:c,dispose:u}}var lh=class{constructor(e={}){let{canvas:n=lA(),context:i=null,depth:s=!0,stencil:r=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:f="default",failIfMajorPerformanceCaveat:p=!1,reversedDepthBuffer:h=!1}=e;this.isWebGLRenderer=!0;let d;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");d=i.getContextAttributes().alpha}else d=a;let y=new Uint32Array(4),_=new Int32Array(4),m=null,u=null,g=[],v=[];this.domElement=n,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=us,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let x=this,T=!1;this._outputColorSpace=At;let C=0,w=0,D=null,E=-1,M=null,U=new Bt,G=new Bt,V=null,Y=new qe(0),O=0,N=n.width,J=n.height,k=1,se=null,pe=null,Me=new Bt(0,0,N,J),Fe=new Bt(0,0,N,J),rt=!1,ht=new Nl,Je=!1,q=!1,K=new Xt,oe=new z,Te=new Bt,ve={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},ke=!1;function Jt(){return D===null?k:1}let R=i;function $e(S,I){return n.getContext(S,I)}try{let S={alpha:!0,depth:s,stencil:r,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:f,failIfMajorPerformanceCaveat:p};if("setAttribute"in n&&n.setAttribute("data-engine",`three.js r${"180"}`),n.addEventListener("webglcontextlost",ae,!1),n.addEventListener("webglcontextrestored",ge,!1),n.addEventListener("webglcontextcreationerror",$,!1),R===null){let I="webgl2";if(R=$e(I,S),R===null)throw $e(I)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(S){throw console.error("THREE.WebGLRenderer: "+S.message),S}let Be,le,re,Ze,de,Ie,Nt,It,b,A,L,X,j,W,Ee,ie,_e,Ae,te,he,Re,Se,ue,Oe;function B(){Be=new Mw(R),Be.init(),Se=new e2(R,Be),le=new gw(R,Be,e,Se),re=new jC(R,Be),le.reversedDepthBuffer&&h&&re.buffers.depth.setReversed(!0),Ze=new bw(R),de=new zC,Ie=new $C(R,Be,re,de,le,Se,Ze),Nt=new xw(x),It=new Sw(x),b=new BE(R),ue=new pw(R,b),A=new Ew(R,b,Ze,ue),L=new Cw(R,A,b,Ze),te=new ww(R,le,Ie),ie=new vw(de),X=new FC(x,Nt,It,Be,le,ue,ie),j=new s2(x,de),W=new GC,Ee=new qC(Be),Ae=new dw(x,Nt,It,re,L,d,l),_e=new KC(x,L,le),Oe=new r2(R,Ze,le,re),he=new mw(R,Be,Ze),Re=new Tw(R,Be,Ze),Ze.programs=X.programs,x.capabilities=le,x.extensions=Be,x.properties=de,x.renderLists=W,x.shadowMap=_e,x.state=re,x.info=Ze}B();let ne=new sg(x,R);this.xr=ne,this.getContext=function(){return R},this.getContextAttributes=function(){return R.getContextAttributes()},this.forceContextLoss=function(){let S=Be.get("WEBGL_lose_context");S&&S.loseContext()},this.forceContextRestore=function(){let S=Be.get("WEBGL_lose_context");S&&S.restoreContext()},this.getPixelRatio=function(){return k},this.setPixelRatio=function(S){S!==void 0&&(k=S,this.setSize(N,J,!1))},this.getSize=function(S){return S.set(N,J)},this.setSize=function(S,I,F=!0){if(ne.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}N=S,J=I,n.width=Math.floor(S*k),n.height=Math.floor(I*k),F===!0&&(n.style.width=S+"px",n.style.height=I+"px"),this.setViewport(0,0,S,I)},this.getDrawingBufferSize=function(S){return S.set(N*k,J*k).floor()},this.setDrawingBufferSize=function(S,I,F){N=S,J=I,k=F,n.width=Math.floor(S*F),n.height=Math.floor(I*F),this.setViewport(0,0,S,I)},this.getCurrentViewport=function(S){return S.copy(U)},this.getViewport=function(S){return S.copy(Me)},this.setViewport=function(S,I,F,H){S.isVector4?Me.set(S.x,S.y,S.z,S.w):Me.set(S,I,F,H),re.viewport(U.copy(Me).multiplyScalar(k).round())},this.getScissor=function(S){return S.copy(Fe)},this.setScissor=function(S,I,F,H){S.isVector4?Fe.set(S.x,S.y,S.z,S.w):Fe.set(S,I,F,H),re.scissor(G.copy(Fe).multiplyScalar(k).round())},this.getScissorTest=function(){return rt},this.setScissorTest=function(S){re.setScissorTest(rt=S)},this.setOpaqueSort=function(S){se=S},this.setTransparentSort=function(S){pe=S},this.getClearColor=function(S){return S.copy(Ae.getClearColor())},this.setClearColor=function(){Ae.setClearColor(...arguments)},this.getClearAlpha=function(){return Ae.getClearAlpha()},this.setClearAlpha=function(){Ae.setClearAlpha(...arguments)},this.clear=function(S=!0,I=!0,F=!0){let H=0;if(S){let P=!1;if(D!==null){let ee=D.texture.format;P=ee===Rf||ee===Cf||ee===wf}if(P){let ee=D.texture.type,fe=ee===sn||ee===$s||ee===ro||ee===er||ee===Tf||ee===bf,xe=Ae.getClearColor(),me=Ae.getClearAlpha(),Ce=xe.r,Ue=xe.g,be=xe.b;fe?(y[0]=Ce,y[1]=Ue,y[2]=be,y[3]=me,R.clearBufferuiv(R.COLOR,0,y)):(_[0]=Ce,_[1]=Ue,_[2]=be,_[3]=me,R.clearBufferiv(R.COLOR,0,_))}else H|=R.COLOR_BUFFER_BIT}I&&(H|=R.DEPTH_BUFFER_BIT),F&&(H|=R.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),R.clear(H)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){n.removeEventListener("webglcontextlost",ae,!1),n.removeEventListener("webglcontextrestored",ge,!1),n.removeEventListener("webglcontextcreationerror",$,!1),Ae.dispose(),W.dispose(),Ee.dispose(),de.dispose(),Nt.dispose(),It.dispose(),L.dispose(),ue.dispose(),Oe.dispose(),X.dispose(),ne.dispose(),ne.removeEventListener("sessionstart",_i),ne.removeEventListener("sessionend",gg),sr.stop()};function ae(S){S.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),T=!0}function ge(){console.log("THREE.WebGLRenderer: Context Restored."),T=!1;let S=Ze.autoReset,I=_e.enabled,F=_e.autoUpdate,H=_e.needsUpdate,P=_e.type;B(),Ze.autoReset=S,_e.enabled=I,_e.autoUpdate=F,_e.needsUpdate=H,_e.type=P}function $(S){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",S.statusMessage)}function Z(S){let I=S.target;I.removeEventListener("dispose",Z),ye(I)}function ye(S){Pe(S),de.remove(S)}function Pe(S){let I=de.get(S).programs;I!==void 0&&(I.forEach(function(F){X.releaseProgram(F)}),S.isShaderMaterial&&X.releaseShaderCache(S))}this.renderBufferDirect=function(S,I,F,H,P,ee){I===null&&(I=ve);let fe=P.isMesh&&P.matrixWorld.determinant()<0,xe=jA(S,I,F,H,P);re.setMaterial(H,fe);let me=F.index,Ce=1;if(H.wireframe===!0){if(me=A.getWireframeAttribute(F),me===void 0)return;Ce=2}let Ue=F.drawRange,be=F.attributes.position,Xe=Ue.start*Ce,ct=(Ue.start+Ue.count)*Ce;ee!==null&&(Xe=Math.max(Xe,ee.start*Ce),ct=Math.min(ct,(ee.start+ee.count)*Ce)),me!==null?(Xe=Math.max(Xe,0),ct=Math.min(ct,me.count)):be!=null&&(Xe=Math.max(Xe,0),ct=Math.min(ct,be.count));let Rt=ct-Xe;if(Rt<0||Rt===1/0)return;ue.setup(P,H,xe,F,me);let xt,dt=he;if(me!==null&&(xt=b.get(me),dt=Re,dt.setIndex(xt)),P.isMesh)H.wireframe===!0?(re.setLineWidth(H.wireframeLinewidth*Jt()),dt.setMode(R.LINES)):dt.setMode(R.TRIANGLES);else if(P.isLine){let we=H.linewidth;we===void 0&&(we=1),re.setLineWidth(we*Jt()),P.isLineSegments?dt.setMode(R.LINES):P.isLineLoop?dt.setMode(R.LINE_LOOP):dt.setMode(R.LINE_STRIP)}else P.isPoints?dt.setMode(R.POINTS):P.isSprite&&dt.setMode(R.TRIANGLES);if(P.isBatchedMesh)if(P._multiDrawInstances!==null)$a("THREE.WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."),dt.renderMultiDrawInstances(P._multiDrawStarts,P._multiDrawCounts,P._multiDrawCount,P._multiDrawInstances);else if(Be.get("WEBGL_multi_draw"))dt.renderMultiDraw(P._multiDrawStarts,P._multiDrawCounts,P._multiDrawCount);else{let we=P._multiDrawStarts,bt=P._multiDrawCounts,et=P._multiDrawCount,Dn=me?b.get(me).bytesPerElement:1,Xr=de.get(H).currentProgram.getUniforms();for(let Un=0;Un<et;Un++)Xr.setValue(R,"_gl_DrawID",Un),dt.render(we[Un]/Dn,bt[Un])}else if(P.isInstancedMesh)dt.renderInstances(Xe,Rt,P.count);else if(F.isInstancedBufferGeometry){let we=F._maxInstanceCount!==void 0?F._maxInstanceCount:1/0,bt=Math.min(F.instanceCount,we);dt.renderInstances(Xe,Rt,bt)}else dt.render(Xe,Rt)};function mt(S,I,F){S.transparent===!0&&S.side===Sn&&S.forceSinglePass===!1?(S.side=Gt,S.needsUpdate=!0,Jl(S,I,F),S.side=vi,S.needsUpdate=!0,Jl(S,I,F),S.side=Sn):Jl(S,I,F)}this.compile=function(S,I,F=null){F===null&&(F=S),u=Ee.get(F),u.init(I),v.push(u),F.traverseVisible(function(P){P.isLight&&P.layers.test(I.layers)&&(u.pushLight(P),P.castShadow&&u.pushShadow(P))}),S!==F&&S.traverseVisible(function(P){P.isLight&&P.layers.test(I.layers)&&(u.pushLight(P),P.castShadow&&u.pushShadow(P))}),u.setupLights();let H=new Set;return S.traverse(function(P){if(!(P.isMesh||P.isPoints||P.isLine||P.isSprite))return;let ee=P.material;if(ee)if(Array.isArray(ee))for(let fe=0;fe<ee.length;fe++){let xe=ee[fe];mt(xe,F,P),H.add(xe)}else mt(ee,F,P),H.add(ee)}),u=v.pop(),H},this.compileAsync=function(S,I,F=null){let H=this.compile(S,I,F);return new Promise(P=>{function ee(){if(H.forEach(function(fe){de.get(fe).currentProgram.isReady()&&H.delete(fe)}),H.size===0){P(S);return}setTimeout(ee,10)}Be.get("KHR_parallel_shader_compile")!==null?ee():setTimeout(ee,10)})};let st=null;function Fi(S){st&&st(S)}function _i(){sr.stop()}function gg(){sr.start()}let sr=new NA;sr.setAnimationLoop(Fi),typeof self<"u"&&sr.setContext(self),this.setAnimationLoop=function(S){st=S,ne.setAnimationLoop(S),S===null?sr.stop():sr.start()},ne.addEventListener("sessionstart",_i),ne.addEventListener("sessionend",gg),this.render=function(S,I){if(I!==void 0&&I.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(T===!0)return;if(S.matrixWorldAutoUpdate===!0&&S.updateMatrixWorld(),I.parent===null&&I.matrixWorldAutoUpdate===!0&&I.updateMatrixWorld(),ne.enabled===!0&&ne.isPresenting===!0&&(ne.cameraAutoUpdate===!0&&ne.updateCamera(I),I=ne.getCamera()),S.isScene===!0&&S.onBeforeRender(x,S,I,D),u=Ee.get(S,v.length),u.init(I),v.push(u),K.multiplyMatrices(I.projectionMatrix,I.matrixWorldInverse),ht.setFromProjectionMatrix(K,gi,I.reversedDepth),q=this.localClippingEnabled,Je=ie.init(this.clippingPlanes,q),m=W.get(S,g.length),m.init(),g.push(m),ne.enabled===!0&&ne.isPresenting===!0){let ee=x.xr.getDepthSensingMesh();ee!==null&&dh(ee,I,-1/0,x.sortObjects)}dh(S,I,0,x.sortObjects),m.finish(),x.sortObjects===!0&&m.sort(se,pe),ke=ne.enabled===!1||ne.isPresenting===!1||ne.hasDepthSensing()===!1,ke&&Ae.addToRenderList(m,S),this.info.render.frame++,Je===!0&&ie.beginShadows();let F=u.state.shadowsArray;_e.render(F,S,I),Je===!0&&ie.endShadows(),this.info.autoReset===!0&&this.info.reset();let H=m.opaque,P=m.transmissive;if(u.setupLights(),I.isArrayCamera){let ee=I.cameras;if(P.length>0)for(let fe=0,xe=ee.length;fe<xe;fe++){let me=ee[fe];xg(H,P,S,me)}ke&&Ae.render(S);for(let fe=0,xe=ee.length;fe<xe;fe++){let me=ee[fe];vg(m,S,me,me.viewport)}}else P.length>0&&xg(H,P,S,I),ke&&Ae.render(S),vg(m,S,I);D!==null&&w===0&&(Ie.updateMultisampleRenderTarget(D),Ie.updateRenderTargetMipmap(D)),S.isScene===!0&&S.onAfterRender(x,S,I),ue.resetDefaultState(),E=-1,M=null,v.pop(),v.length>0?(u=v[v.length-1],Je===!0&&ie.setGlobalState(x.clippingPlanes,u.state.camera)):u=null,g.pop(),g.length>0?m=g[g.length-1]:m=null};function dh(S,I,F,H){if(S.visible===!1)return;if(S.layers.test(I.layers)){if(S.isGroup)F=S.renderOrder;else if(S.isLOD)S.autoUpdate===!0&&S.update(I);else if(S.isLight)u.pushLight(S),S.castShadow&&u.pushShadow(S);else if(S.isSprite){if(!S.frustumCulled||ht.intersectsSprite(S)){H&&Te.setFromMatrixPosition(S.matrixWorld).applyMatrix4(K);let fe=L.update(S),xe=S.material;xe.visible&&m.push(S,fe,xe,F,Te.z,null)}}else if((S.isMesh||S.isLine||S.isPoints)&&(!S.frustumCulled||ht.intersectsObject(S))){let fe=L.update(S),xe=S.material;if(H&&(S.boundingSphere!==void 0?(S.boundingSphere===null&&S.computeBoundingSphere(),Te.copy(S.boundingSphere.center)):(fe.boundingSphere===null&&fe.computeBoundingSphere(),Te.copy(fe.boundingSphere.center)),Te.applyMatrix4(S.matrixWorld).applyMatrix4(K)),Array.isArray(xe)){let me=fe.groups;for(let Ce=0,Ue=me.length;Ce<Ue;Ce++){let be=me[Ce],Xe=xe[be.materialIndex];Xe&&Xe.visible&&m.push(S,fe,Xe,F,Te.z,be)}}else xe.visible&&m.push(S,fe,xe,F,Te.z,null)}}let ee=S.children;for(let fe=0,xe=ee.length;fe<xe;fe++)dh(ee[fe],I,F,H)}function vg(S,I,F,H){let P=S.opaque,ee=S.transmissive,fe=S.transparent;u.setupLightsView(F),Je===!0&&ie.setGlobalState(x.clippingPlanes,F),H&&re.viewport(U.copy(H)),P.length>0&&Kl(P,I,F),ee.length>0&&Kl(ee,I,F),fe.length>0&&Kl(fe,I,F),re.buffers.depth.setTest(!0),re.buffers.depth.setMask(!0),re.buffers.color.setMask(!0),re.setPolygonOffset(!1)}function xg(S,I,F,H){if((F.isScene===!0?F.overrideMaterial:null)!==null)return;u.state.transmissionRenderTarget[H.id]===void 0&&(u.state.transmissionRenderTarget[H.id]=new qt(1,1,{generateMipmaps:!0,type:Be.has("EXT_color_buffer_half_float")||Be.has("EXT_color_buffer_float")?ao:sn,minFilter:js,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:je.workingColorSpace}));let ee=u.state.transmissionRenderTarget[H.id],fe=H.viewport||U;ee.setSize(fe.z*x.transmissionResolutionScale,fe.w*x.transmissionResolutionScale);let xe=x.getRenderTarget(),me=x.getActiveCubeFace(),Ce=x.getActiveMipmapLevel();x.setRenderTarget(ee),x.getClearColor(Y),O=x.getClearAlpha(),O<1&&x.setClearColor(16777215,.5),x.clear(),ke&&Ae.render(F);let Ue=x.toneMapping;x.toneMapping=us;let be=H.viewport;if(H.viewport!==void 0&&(H.viewport=void 0),u.setupLightsView(H),Je===!0&&ie.setGlobalState(x.clippingPlanes,H),Kl(S,F,H),Ie.updateMultisampleRenderTarget(ee),Ie.updateRenderTargetMipmap(ee),Be.has("WEBGL_multisampled_render_to_texture")===!1){let Xe=!1;for(let ct=0,Rt=I.length;ct<Rt;ct++){let xt=I[ct],dt=xt.object,we=xt.geometry,bt=xt.material,et=xt.group;if(bt.side===Sn&&dt.layers.test(H.layers)){let Dn=bt.side;bt.side=Gt,bt.needsUpdate=!0,yg(dt,F,H,we,bt,et),bt.side=Dn,bt.needsUpdate=!0,Xe=!0}}Xe===!0&&(Ie.updateMultisampleRenderTarget(ee),Ie.updateRenderTargetMipmap(ee))}x.setRenderTarget(xe,me,Ce),x.setClearColor(Y,O),be!==void 0&&(H.viewport=be),x.toneMapping=Ue}function Kl(S,I,F){let H=I.isScene===!0?I.overrideMaterial:null;for(let P=0,ee=S.length;P<ee;P++){let fe=S[P],xe=fe.object,me=fe.geometry,Ce=fe.group,Ue=fe.material;Ue.allowOverride===!0&&H!==null&&(Ue=H),xe.layers.test(F.layers)&&yg(xe,I,F,me,Ue,Ce)}}function yg(S,I,F,H,P,ee){S.onBeforeRender(x,I,F,H,P,ee),S.modelViewMatrix.multiplyMatrices(F.matrixWorldInverse,S.matrixWorld),S.normalMatrix.getNormalMatrix(S.modelViewMatrix),P.onBeforeRender(x,I,F,H,S,ee),P.transparent===!0&&P.side===Sn&&P.forceSinglePass===!1?(P.side=Gt,P.needsUpdate=!0,x.renderBufferDirect(F,I,H,P,S,ee),P.side=vi,P.needsUpdate=!0,x.renderBufferDirect(F,I,H,P,S,ee),P.side=Sn):x.renderBufferDirect(F,I,H,P,S,ee),S.onAfterRender(x,I,F,H,P,ee)}function Jl(S,I,F){I.isScene!==!0&&(I=ve);let H=de.get(S),P=u.state.lights,ee=u.state.shadowsArray,fe=P.state.version,xe=X.getParameters(S,P.state,ee,I,F),me=X.getProgramCacheKey(xe),Ce=H.programs;H.environment=S.isMeshStandardMaterial?I.environment:null,H.fog=I.fog,H.envMap=(S.isMeshStandardMaterial?It:Nt).get(S.envMap||H.environment),H.envMapRotation=H.environment!==null&&S.envMap===null?I.environmentRotation:S.envMapRotation,Ce===void 0&&(S.addEventListener("dispose",Z),Ce=new Map,H.programs=Ce);let Ue=Ce.get(me);if(Ue!==void 0){if(H.currentProgram===Ue&&H.lightsStateVersion===fe)return Ag(S,xe),Ue}else xe.uniforms=X.getUniforms(S),S.onBeforeCompile(xe,x),Ue=X.acquireProgram(xe,me),Ce.set(me,Ue),H.uniforms=xe.uniforms;let be=H.uniforms;return(!S.isShaderMaterial&&!S.isRawShaderMaterial||S.clipping===!0)&&(be.clippingPlanes=ie.uniform),Ag(S,xe),H.needsLights=eS(S),H.lightsStateVersion=fe,H.needsLights&&(be.ambientLightColor.value=P.state.ambient,be.lightProbe.value=P.state.probe,be.directionalLights.value=P.state.directional,be.directionalLightShadows.value=P.state.directionalShadow,be.spotLights.value=P.state.spot,be.spotLightShadows.value=P.state.spotShadow,be.rectAreaLights.value=P.state.rectArea,be.ltc_1.value=P.state.rectAreaLTC1,be.ltc_2.value=P.state.rectAreaLTC2,be.pointLights.value=P.state.point,be.pointLightShadows.value=P.state.pointShadow,be.hemisphereLights.value=P.state.hemi,be.directionalShadowMap.value=P.state.directionalShadowMap,be.directionalShadowMatrix.value=P.state.directionalShadowMatrix,be.spotShadowMap.value=P.state.spotShadowMap,be.spotLightMatrix.value=P.state.spotLightMatrix,be.spotLightMap.value=P.state.spotLightMap,be.pointShadowMap.value=P.state.pointShadowMap,be.pointShadowMatrix.value=P.state.pointShadowMatrix),H.currentProgram=Ue,H.uniformsList=null,Ue}function _g(S){if(S.uniformsList===null){let I=S.currentProgram.getUniforms();S.uniformsList=co.seqWithValue(I.seq,S.uniforms)}return S.uniformsList}function Ag(S,I){let F=de.get(S);F.outputColorSpace=I.outputColorSpace,F.batching=I.batching,F.batchingColor=I.batchingColor,F.instancing=I.instancing,F.instancingColor=I.instancingColor,F.instancingMorph=I.instancingMorph,F.skinning=I.skinning,F.morphTargets=I.morphTargets,F.morphNormals=I.morphNormals,F.morphColors=I.morphColors,F.morphTargetsCount=I.morphTargetsCount,F.numClippingPlanes=I.numClippingPlanes,F.numIntersection=I.numClipIntersection,F.vertexAlphas=I.vertexAlphas,F.vertexTangents=I.vertexTangents,F.toneMapping=I.toneMapping}function jA(S,I,F,H,P){I.isScene!==!0&&(I=ve),Ie.resetTextureUnits();let ee=I.fog,fe=H.isMeshStandardMaterial?I.environment:null,xe=D===null?x.outputColorSpace:D.isXRRenderTarget===!0?D.texture.colorSpace:xi,me=(H.isMeshStandardMaterial?It:Nt).get(H.envMap||fe),Ce=H.vertexColors===!0&&!!F.attributes.color&&F.attributes.color.itemSize===4,Ue=!!F.attributes.tangent&&(!!H.normalMap||H.anisotropy>0),be=!!F.morphAttributes.position,Xe=!!F.morphAttributes.normal,ct=!!F.morphAttributes.color,Rt=us;H.toneMapped&&(D===null||D.isXRRenderTarget===!0)&&(Rt=x.toneMapping);let xt=F.morphAttributes.position||F.morphAttributes.normal||F.morphAttributes.color,dt=xt!==void 0?xt.length:0,we=de.get(H),bt=u.state.lights;if(Je===!0&&(q===!0||S!==M)){let xn=S===M&&H.id===E;ie.setState(H,S,xn)}let et=!1;H.version===we.__version?(we.needsLights&&we.lightsStateVersion!==bt.state.version||we.outputColorSpace!==xe||P.isBatchedMesh&&we.batching===!1||!P.isBatchedMesh&&we.batching===!0||P.isBatchedMesh&&we.batchingColor===!0&&P.colorTexture===null||P.isBatchedMesh&&we.batchingColor===!1&&P.colorTexture!==null||P.isInstancedMesh&&we.instancing===!1||!P.isInstancedMesh&&we.instancing===!0||P.isSkinnedMesh&&we.skinning===!1||!P.isSkinnedMesh&&we.skinning===!0||P.isInstancedMesh&&we.instancingColor===!0&&P.instanceColor===null||P.isInstancedMesh&&we.instancingColor===!1&&P.instanceColor!==null||P.isInstancedMesh&&we.instancingMorph===!0&&P.morphTexture===null||P.isInstancedMesh&&we.instancingMorph===!1&&P.morphTexture!==null||we.envMap!==me||H.fog===!0&&we.fog!==ee||we.numClippingPlanes!==void 0&&(we.numClippingPlanes!==ie.numPlanes||we.numIntersection!==ie.numIntersection)||we.vertexAlphas!==Ce||we.vertexTangents!==Ue||we.morphTargets!==be||we.morphNormals!==Xe||we.morphColors!==ct||we.toneMapping!==Rt||we.morphTargetsCount!==dt)&&(et=!0):(et=!0,we.__version=H.version);let Dn=we.currentProgram;et===!0&&(Dn=Jl(H,I,P));let Xr=!1,Un=!1,fo=!1,wt=Dn.getUniforms(),qn=we.uniforms;if(re.useProgram(Dn.program)&&(Xr=!0,Un=!0,fo=!0),H.id!==E&&(E=H.id,Un=!0),Xr||M!==S){re.buffers.depth.getReversed()&&S.reversedDepth!==!0&&(S._reversedDepth=!0,S.updateProjectionMatrix()),wt.setValue(R,"projectionMatrix",S.projectionMatrix),wt.setValue(R,"viewMatrix",S.matrixWorldInverse);let Mn=wt.map.cameraPosition;Mn!==void 0&&Mn.setValue(R,oe.setFromMatrixPosition(S.matrixWorld)),le.logarithmicDepthBuffer&&wt.setValue(R,"logDepthBufFC",2/(Math.log(S.far+1)/Math.LN2)),(H.isMeshPhongMaterial||H.isMeshToonMaterial||H.isMeshLambertMaterial||H.isMeshBasicMaterial||H.isMeshStandardMaterial||H.isShaderMaterial)&&wt.setValue(R,"isOrthographic",S.isOrthographicCamera===!0),M!==S&&(M=S,Un=!0,fo=!0)}if(P.isSkinnedMesh){wt.setOptional(R,P,"bindMatrix"),wt.setOptional(R,P,"bindMatrixInverse");let xn=P.skeleton;xn&&(xn.boneTexture===null&&xn.computeBoneTexture(),wt.setValue(R,"boneTexture",xn.boneTexture,Ie))}P.isBatchedMesh&&(wt.setOptional(R,P,"batchingTexture"),wt.setValue(R,"batchingTexture",P._matricesTexture,Ie),wt.setOptional(R,P,"batchingIdTexture"),wt.setValue(R,"batchingIdTexture",P._indirectTexture,Ie),wt.setOptional(R,P,"batchingColorTexture"),P._colorsTexture!==null&&wt.setValue(R,"batchingColorTexture",P._colorsTexture,Ie));let Qn=F.morphAttributes;if((Qn.position!==void 0||Qn.normal!==void 0||Qn.color!==void 0)&&te.update(P,F,Dn),(Un||we.receiveShadow!==P.receiveShadow)&&(we.receiveShadow=P.receiveShadow,wt.setValue(R,"receiveShadow",P.receiveShadow)),H.isMeshGouraudMaterial&&H.envMap!==null&&(qn.envMap.value=me,qn.flipEnvMap.value=me.isCubeTexture&&me.isRenderTargetTexture===!1?-1:1),H.isMeshStandardMaterial&&H.envMap===null&&I.environment!==null&&(qn.envMapIntensity.value=I.environmentIntensity),Un&&(wt.setValue(R,"toneMappingExposure",x.toneMappingExposure),we.needsLights&&$A(qn,fo),ee&&H.fog===!0&&j.refreshFogUniforms(qn,ee),j.refreshMaterialUniforms(qn,H,k,J,u.state.transmissionRenderTarget[S.id]),co.upload(R,_g(we),qn,Ie)),H.isShaderMaterial&&H.uniformsNeedUpdate===!0&&(co.upload(R,_g(we),qn,Ie),H.uniformsNeedUpdate=!1),H.isSpriteMaterial&&wt.setValue(R,"center",P.center),wt.setValue(R,"modelViewMatrix",P.modelViewMatrix),wt.setValue(R,"normalMatrix",P.normalMatrix),wt.setValue(R,"modelMatrix",P.matrixWorld),H.isShaderMaterial||H.isRawShaderMaterial){let xn=H.uniformsGroups;for(let Mn=0,ph=xn.length;Mn<ph;Mn++){let rr=xn[Mn];Oe.update(rr,Dn),Oe.bind(rr,Dn)}}return Dn}function $A(S,I){S.ambientLightColor.needsUpdate=I,S.lightProbe.needsUpdate=I,S.directionalLights.needsUpdate=I,S.directionalLightShadows.needsUpdate=I,S.pointLights.needsUpdate=I,S.pointLightShadows.needsUpdate=I,S.spotLights.needsUpdate=I,S.spotLightShadows.needsUpdate=I,S.rectAreaLights.needsUpdate=I,S.hemisphereLights.needsUpdate=I}function eS(S){return S.isMeshLambertMaterial||S.isMeshToonMaterial||S.isMeshPhongMaterial||S.isMeshStandardMaterial||S.isShadowMaterial||S.isShaderMaterial&&S.lights===!0}this.getActiveCubeFace=function(){return C},this.getActiveMipmapLevel=function(){return w},this.getRenderTarget=function(){return D},this.setRenderTargetTextures=function(S,I,F){let H=de.get(S);H.__autoAllocateDepthBuffer=S.resolveDepthBuffer===!1,H.__autoAllocateDepthBuffer===!1&&(H.__useRenderToTexture=!1),de.get(S.texture).__webglTexture=I,de.get(S.depthTexture).__webglTexture=H.__autoAllocateDepthBuffer?void 0:F,H.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(S,I){let F=de.get(S);F.__webglFramebuffer=I,F.__useDefaultFramebuffer=I===void 0};let tS=R.createFramebuffer();this.setRenderTarget=function(S,I=0,F=0){D=S,C=I,w=F;let H=!0,P=null,ee=!1,fe=!1;if(S){let me=de.get(S);if(me.__useDefaultFramebuffer!==void 0)re.bindFramebuffer(R.FRAMEBUFFER,null),H=!1;else if(me.__webglFramebuffer===void 0)Ie.setupRenderTarget(S);else if(me.__hasExternalTextures)Ie.rebindTextures(S,de.get(S.texture).__webglTexture,de.get(S.depthTexture).__webglTexture);else if(S.depthBuffer){let be=S.depthTexture;if(me.__boundDepthTexture!==be){if(be!==null&&de.has(be)&&(S.width!==be.image.width||S.height!==be.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");Ie.setupDepthRenderbuffer(S)}}let Ce=S.texture;(Ce.isData3DTexture||Ce.isDataArrayTexture||Ce.isCompressedArrayTexture)&&(fe=!0);let Ue=de.get(S).__webglFramebuffer;S.isWebGLCubeRenderTarget?(Array.isArray(Ue[I])?P=Ue[I][F]:P=Ue[I],ee=!0):S.samples>0&&Ie.useMultisampledRTT(S)===!1?P=de.get(S).__webglMultisampledFramebuffer:Array.isArray(Ue)?P=Ue[F]:P=Ue,U.copy(S.viewport),G.copy(S.scissor),V=S.scissorTest}else U.copy(Me).multiplyScalar(k).floor(),G.copy(Fe).multiplyScalar(k).floor(),V=rt;if(F!==0&&(P=tS),re.bindFramebuffer(R.FRAMEBUFFER,P)&&H&&re.drawBuffers(S,P),re.viewport(U),re.scissor(G),re.setScissorTest(V),ee){let me=de.get(S.texture);R.framebufferTexture2D(R.FRAMEBUFFER,R.COLOR_ATTACHMENT0,R.TEXTURE_CUBE_MAP_POSITIVE_X+I,me.__webglTexture,F)}else if(fe){let me=I;for(let Ce=0;Ce<S.textures.length;Ce++){let Ue=de.get(S.textures[Ce]);R.framebufferTextureLayer(R.FRAMEBUFFER,R.COLOR_ATTACHMENT0+Ce,Ue.__webglTexture,F,me)}}else if(S!==null&&F!==0){let me=de.get(S.texture);R.framebufferTexture2D(R.FRAMEBUFFER,R.COLOR_ATTACHMENT0,R.TEXTURE_2D,me.__webglTexture,F)}E=-1},this.readRenderTargetPixels=function(S,I,F,H,P,ee,fe,xe=0){if(!(S&&S.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let me=de.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&fe!==void 0&&(me=me[fe]),me){re.bindFramebuffer(R.FRAMEBUFFER,me);try{let Ce=S.textures[xe],Ue=Ce.format,be=Ce.type;if(!le.textureFormatReadable(Ue)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!le.textureTypeReadable(be)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}I>=0&&I<=S.width-H&&F>=0&&F<=S.height-P&&(S.textures.length>1&&R.readBuffer(R.COLOR_ATTACHMENT0+xe),R.readPixels(I,F,H,P,Se.convert(Ue),Se.convert(be),ee))}finally{let Ce=D!==null?de.get(D).__webglFramebuffer:null;re.bindFramebuffer(R.FRAMEBUFFER,Ce)}}},this.readRenderTargetPixelsAsync=async function(S,I,F,H,P,ee,fe,xe=0){if(!(S&&S.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let me=de.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&fe!==void 0&&(me=me[fe]),me)if(I>=0&&I<=S.width-H&&F>=0&&F<=S.height-P){re.bindFramebuffer(R.FRAMEBUFFER,me);let Ce=S.textures[xe],Ue=Ce.format,be=Ce.type;if(!le.textureFormatReadable(Ue))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!le.textureTypeReadable(be))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Xe=R.createBuffer();R.bindBuffer(R.PIXEL_PACK_BUFFER,Xe),R.bufferData(R.PIXEL_PACK_BUFFER,ee.byteLength,R.STREAM_READ),S.textures.length>1&&R.readBuffer(R.COLOR_ATTACHMENT0+xe),R.readPixels(I,F,H,P,Se.convert(Ue),Se.convert(be),0);let ct=D!==null?de.get(D).__webglFramebuffer:null;re.bindFramebuffer(R.FRAMEBUFFER,ct);let Rt=R.fenceSync(R.SYNC_GPU_COMMANDS_COMPLETE,0);return R.flush(),await cA(R,Rt,4),R.bindBuffer(R.PIXEL_PACK_BUFFER,Xe),R.getBufferSubData(R.PIXEL_PACK_BUFFER,0,ee),R.deleteBuffer(Xe),R.deleteSync(Rt),ee}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(S,I=null,F=0){let H=Math.pow(2,-F),P=Math.floor(S.image.width*H),ee=Math.floor(S.image.height*H),fe=I!==null?I.x:0,xe=I!==null?I.y:0;Ie.setTexture2D(S,0),R.copyTexSubImage2D(R.TEXTURE_2D,F,0,0,fe,xe,P,ee),re.unbindTexture()};let nS=R.createFramebuffer(),iS=R.createFramebuffer();this.copyTextureToTexture=function(S,I,F=null,H=null,P=0,ee=null){ee===null&&(P!==0?($a("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),ee=P,P=0):ee=0);let fe,xe,me,Ce,Ue,be,Xe,ct,Rt,xt=S.isCompressedTexture?S.mipmaps[ee]:S.image;if(F!==null)fe=F.max.x-F.min.x,xe=F.max.y-F.min.y,me=F.isBox3?F.max.z-F.min.z:1,Ce=F.min.x,Ue=F.min.y,be=F.isBox3?F.min.z:0;else{let Qn=Math.pow(2,-P);fe=Math.floor(xt.width*Qn),xe=Math.floor(xt.height*Qn),S.isDataArrayTexture?me=xt.depth:S.isData3DTexture?me=Math.floor(xt.depth*Qn):me=1,Ce=0,Ue=0,be=0}H!==null?(Xe=H.x,ct=H.y,Rt=H.z):(Xe=0,ct=0,Rt=0);let dt=Se.convert(I.format),we=Se.convert(I.type),bt;I.isData3DTexture?(Ie.setTexture3D(I,0),bt=R.TEXTURE_3D):I.isDataArrayTexture||I.isCompressedArrayTexture?(Ie.setTexture2DArray(I,0),bt=R.TEXTURE_2D_ARRAY):(Ie.setTexture2D(I,0),bt=R.TEXTURE_2D),R.pixelStorei(R.UNPACK_FLIP_Y_WEBGL,I.flipY),R.pixelStorei(R.UNPACK_PREMULTIPLY_ALPHA_WEBGL,I.premultiplyAlpha),R.pixelStorei(R.UNPACK_ALIGNMENT,I.unpackAlignment);let et=R.getParameter(R.UNPACK_ROW_LENGTH),Dn=R.getParameter(R.UNPACK_IMAGE_HEIGHT),Xr=R.getParameter(R.UNPACK_SKIP_PIXELS),Un=R.getParameter(R.UNPACK_SKIP_ROWS),fo=R.getParameter(R.UNPACK_SKIP_IMAGES);R.pixelStorei(R.UNPACK_ROW_LENGTH,xt.width),R.pixelStorei(R.UNPACK_IMAGE_HEIGHT,xt.height),R.pixelStorei(R.UNPACK_SKIP_PIXELS,Ce),R.pixelStorei(R.UNPACK_SKIP_ROWS,Ue),R.pixelStorei(R.UNPACK_SKIP_IMAGES,be);let wt=S.isDataArrayTexture||S.isData3DTexture,qn=I.isDataArrayTexture||I.isData3DTexture;if(S.isDepthTexture){let Qn=de.get(S),xn=de.get(I),Mn=de.get(Qn.__renderTarget),ph=de.get(xn.__renderTarget);re.bindFramebuffer(R.READ_FRAMEBUFFER,Mn.__webglFramebuffer),re.bindFramebuffer(R.DRAW_FRAMEBUFFER,ph.__webglFramebuffer);for(let rr=0;rr<me;rr++)wt&&(R.framebufferTextureLayer(R.READ_FRAMEBUFFER,R.COLOR_ATTACHMENT0,de.get(S).__webglTexture,P,be+rr),R.framebufferTextureLayer(R.DRAW_FRAMEBUFFER,R.COLOR_ATTACHMENT0,de.get(I).__webglTexture,ee,Rt+rr)),R.blitFramebuffer(Ce,Ue,fe,xe,Xe,ct,fe,xe,R.DEPTH_BUFFER_BIT,R.NEAREST);re.bindFramebuffer(R.READ_FRAMEBUFFER,null),re.bindFramebuffer(R.DRAW_FRAMEBUFFER,null)}else if(P!==0||S.isRenderTargetTexture||de.has(S)){let Qn=de.get(S),xn=de.get(I);re.bindFramebuffer(R.READ_FRAMEBUFFER,nS),re.bindFramebuffer(R.DRAW_FRAMEBUFFER,iS);for(let Mn=0;Mn<me;Mn++)wt?R.framebufferTextureLayer(R.READ_FRAMEBUFFER,R.COLOR_ATTACHMENT0,Qn.__webglTexture,P,be+Mn):R.framebufferTexture2D(R.READ_FRAMEBUFFER,R.COLOR_ATTACHMENT0,R.TEXTURE_2D,Qn.__webglTexture,P),qn?R.framebufferTextureLayer(R.DRAW_FRAMEBUFFER,R.COLOR_ATTACHMENT0,xn.__webglTexture,ee,Rt+Mn):R.framebufferTexture2D(R.DRAW_FRAMEBUFFER,R.COLOR_ATTACHMENT0,R.TEXTURE_2D,xn.__webglTexture,ee),P!==0?R.blitFramebuffer(Ce,Ue,fe,xe,Xe,ct,fe,xe,R.COLOR_BUFFER_BIT,R.NEAREST):qn?R.copyTexSubImage3D(bt,ee,Xe,ct,Rt+Mn,Ce,Ue,fe,xe):R.copyTexSubImage2D(bt,ee,Xe,ct,Ce,Ue,fe,xe);re.bindFramebuffer(R.READ_FRAMEBUFFER,null),re.bindFramebuffer(R.DRAW_FRAMEBUFFER,null)}else qn?S.isDataTexture||S.isData3DTexture?R.texSubImage3D(bt,ee,Xe,ct,Rt,fe,xe,me,dt,we,xt.data):I.isCompressedArrayTexture?R.compressedTexSubImage3D(bt,ee,Xe,ct,Rt,fe,xe,me,dt,xt.data):R.texSubImage3D(bt,ee,Xe,ct,Rt,fe,xe,me,dt,we,xt):S.isDataTexture?R.texSubImage2D(R.TEXTURE_2D,ee,Xe,ct,fe,xe,dt,we,xt.data):S.isCompressedTexture?R.compressedTexSubImage2D(R.TEXTURE_2D,ee,Xe,ct,xt.width,xt.height,dt,xt.data):R.texSubImage2D(R.TEXTURE_2D,ee,Xe,ct,fe,xe,dt,we,xt);R.pixelStorei(R.UNPACK_ROW_LENGTH,et),R.pixelStorei(R.UNPACK_IMAGE_HEIGHT,Dn),R.pixelStorei(R.UNPACK_SKIP_PIXELS,Xr),R.pixelStorei(R.UNPACK_SKIP_ROWS,Un),R.pixelStorei(R.UNPACK_SKIP_IMAGES,fo),ee===0&&I.generateMipmaps&&R.generateMipmap(bt),re.unbindTexture()},this.initRenderTarget=function(S){de.get(S).__webglFramebuffer===void 0&&Ie.setupRenderTarget(S)},this.initTexture=function(S){S.isCubeTexture?Ie.setTextureCube(S,0):S.isData3DTexture?Ie.setTexture3D(S,0):S.isDataArrayTexture||S.isCompressedArrayTexture?Ie.setTexture2DArray(S,0):Ie.setTexture2D(S,0),re.unbindTexture()},this.resetState=function(){C=0,w=0,D=null,re.reset(),ue.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return gi}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let n=this.getContext();n.drawingBufferColorSpace=je._getDrawingBufferColorSpace(e),n.unpackColorSpace=je._getUnpackColorSpace()}};var o2=(()=>{let t=new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),e=new Float32Array([0,0,2,0,0,2]),n=new Pi;return n.setAttribute("position",new pn(t,3)),n.setAttribute("uv",new pn(e,2)),n})(),nr=class cg{static get fullscreenGeometry(){return o2}constructor(e="Pass",n=new Qs,i=new Js){this.name=e,this.renderer=null,this.scene=n,this.camera=i,this.screen=null,this.rtt=!0,this.needsSwap=!0,this.needsDepthBlit=!1,this.needsDepthTexture=!1,this.enabled=!0}get renderToScreen(){return!this.rtt}set renderToScreen(e){if(this.rtt===e){let n=this.fullscreenMaterial;n!==null&&(n.needsUpdate=!0),this.rtt=!e}}set mainScene(e){}set mainCamera(e){}setRenderer(e){this.renderer=e}isEnabled(){return this.enabled}setEnabled(e){this.enabled=e}get fullscreenMaterial(){return this.screen!==null?this.screen.material:null}set fullscreenMaterial(e){let n=this.screen;n!==null?n.material=e:(n=new mn(cg.fullscreenGeometry,e),n.frustumCulled=!1,this.scene===null&&(this.scene=new Qs),this.scene.add(n),this.screen=n)}getFullscreenMaterial(){return this.fullscreenMaterial}setFullscreenMaterial(e){this.fullscreenMaterial=e}getDepthTexture(){return null}setDepthTexture(e,n=Ni){}render(e,n,i,s,r){throw new Error("Render method not implemented!")}setSize(e,n){}initialize(e,n,i){}dispose(){for(let e of Object.keys(this)){let n=this[e];(n instanceof qt||n instanceof yi||n instanceof Yt||n instanceof cg)&&this[e].dispose()}this.fullscreenMaterial!==null&&this.fullscreenMaterial.dispose()}},l2=class extends nr{constructor(){super("ClearMaskPass",null,null),this.needsSwap=!1}render(t,e,n,i,s){let r=t.state.buffers.stencil;r.setLocked(!1),r.setTest(!1)}},c2=`#ifdef COLOR_WRITE
#include <common>
#include <dithering_pars_fragment>
#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D inputBuffer;
#else
uniform lowp sampler2D inputBuffer;
#endif
#endif
#ifdef DEPTH_WRITE
#include <packing>
#ifdef GL_FRAGMENT_PRECISION_HIGH
uniform highp sampler2D depthBuffer;
#else
uniform mediump sampler2D depthBuffer;
#endif
float readDepth(const in vec2 uv){
#if DEPTH_PACKING == 3201
return unpackRGBAToDepth(texture2D(depthBuffer,uv));
#else
return texture2D(depthBuffer,uv).r;
#endif
}
#endif
#ifdef USE_WEIGHTS
uniform vec4 channelWeights;
#endif
uniform float opacity;varying vec2 vUv;void main(){
#ifdef COLOR_WRITE
vec4 texel=texture2D(inputBuffer,vUv);
#ifdef USE_WEIGHTS
texel*=channelWeights;
#endif
gl_FragColor=opacity*texel;
#ifdef COLOR_SPACE_CONVERSION
#include <colorspace_fragment>
#endif
#include <dithering_fragment>
#else
gl_FragColor=vec4(0.0);
#endif
#ifdef DEPTH_WRITE
gl_FragDepth=readDepth(vUv);
#endif
}`,u2="varying vec2 vUv;void main(){vUv=position.xy*0.5+0.5;gl_Position=vec4(position.xy,1.0,1.0);}",f2=class extends Qt{constructor(){super({name:"CopyMaterial",defines:{COLOR_SPACE_CONVERSION:"1",DEPTH_PACKING:"0",COLOR_WRITE:"1"},uniforms:{inputBuffer:new vt(null),depthBuffer:new vt(null),channelWeights:new vt(null),opacity:new vt(1)},blending:Xn,toneMapped:!1,depthWrite:!1,depthTest:!1,fragmentShader:c2,vertexShader:u2}),this.depthFunc=so}get inputBuffer(){return this.uniforms.inputBuffer.value}set inputBuffer(t){let e=t!==null;this.colorWrite!==e&&(e?this.defines.COLOR_WRITE=!0:delete this.defines.COLOR_WRITE,this.colorWrite=e,this.needsUpdate=!0),this.uniforms.inputBuffer.value=t}get depthBuffer(){return this.uniforms.depthBuffer.value}set depthBuffer(t){let e=t!==null;this.depthWrite!==e&&(e?this.defines.DEPTH_WRITE=!0:delete this.defines.DEPTH_WRITE,this.depthTest=e,this.depthWrite=e,this.needsUpdate=!0),this.uniforms.depthBuffer.value=t}set depthPacking(t){this.defines.DEPTH_PACKING=t.toFixed(0),this.needsUpdate=!0}get colorSpaceConversion(){return this.defines.COLOR_SPACE_CONVERSION!==void 0}set colorSpaceConversion(t){this.colorSpaceConversion!==t&&(t?this.defines.COLOR_SPACE_CONVERSION=!0:delete this.defines.COLOR_SPACE_CONVERSION,this.needsUpdate=!0)}get channelWeights(){return this.uniforms.channelWeights.value}set channelWeights(t){t!==null?(this.defines.USE_WEIGHTS="1",this.uniforms.channelWeights.value=t):delete this.defines.USE_WEIGHTS,this.needsUpdate=!0}setInputBuffer(t){this.uniforms.inputBuffer.value=t}getOpacity(t){return this.uniforms.opacity.value}setOpacity(t){this.uniforms.opacity.value=t}},h2=class extends nr{constructor(t,e=!0){super("CopyPass"),this.fullscreenMaterial=new f2,this.needsSwap=!1,this.renderTarget=t,t===void 0&&(this.renderTarget=new qt(1,1,{minFilter:Ht,magFilter:Ht,stencilBuffer:!1,depthBuffer:!1}),this.renderTarget.texture.name="CopyPass.Target"),this.autoResize=e}get resize(){return this.autoResize}set resize(t){this.autoResize=t}get texture(){return this.renderTarget.texture}getTexture(){return this.renderTarget.texture}setAutoResizeEnabled(t){this.autoResize=t}render(t,e,n,i,s){this.fullscreenMaterial.inputBuffer=e.texture,t.setRenderTarget(this.renderToScreen?null:this.renderTarget),t.render(this.scene,this.camera)}setSize(t,e){this.autoResize&&this.renderTarget.setSize(t,e)}initialize(t,e,n){n!==void 0&&(this.renderTarget.texture.type=n,n!==sn?this.fullscreenMaterial.defines.FRAMEBUFFER_PRECISION_HIGH="1":t!==null&&t.outputColorSpace===At&&(this.renderTarget.texture.colorSpace=At))}},GA=new qe,WA=class extends nr{constructor(t=!0,e=!0,n=!1){super("ClearPass",null,null),this.needsSwap=!1,this.color=t,this.depth=e,this.stencil=n,this.overrideClearColor=null,this.overrideClearAlpha=-1}setClearFlags(t,e,n){this.color=t,this.depth=e,this.stencil=n}getOverrideClearColor(){return this.overrideClearColor}setOverrideClearColor(t){this.overrideClearColor=t}getOverrideClearAlpha(){return this.overrideClearAlpha}setOverrideClearAlpha(t){this.overrideClearAlpha=t}render(t,e,n,i,s){let r=this.overrideClearColor,a=this.overrideClearAlpha,o=t.getClearAlpha(),l=r!==null,c=a>=0;l?(t.getClearColor(GA),t.setClearColor(r,c?a:o)):c&&t.setClearAlpha(a),t.setRenderTarget(this.renderToScreen?null:e),t.clear(this.color,this.depth,this.stencil),l?t.setClearColor(GA,o):c&&t.setClearAlpha(o)}},d2=class extends nr{constructor(t,e){super("MaskPass",t,e),this.needsSwap=!1,this.clearPass=new WA(!1,!1,!0),this.inverse=!1}set mainScene(t){this.scene=t}set mainCamera(t){this.camera=t}get inverted(){return this.inverse}set inverted(t){this.inverse=t}get clear(){return this.clearPass.enabled}set clear(t){this.clearPass.enabled=t}getClearPass(){return this.clearPass}isInverted(){return this.inverted}setInverted(t){this.inverted=t}render(t,e,n,i,s){let r=t.getContext(),a=t.state.buffers,o=this.scene,l=this.camera,c=this.clearPass,f=this.inverted?0:1,p=1-f;a.color.setMask(!1),a.depth.setMask(!1),a.color.setLocked(!0),a.depth.setLocked(!0),a.stencil.setTest(!0),a.stencil.setOp(r.REPLACE,r.REPLACE,r.REPLACE),a.stencil.setFunc(r.ALWAYS,f,4294967295),a.stencil.setClear(p),a.stencil.setLocked(!0),this.clearPass.enabled&&(this.renderToScreen?c.render(t,null):(c.render(t,e),c.render(t,n))),this.renderToScreen?(t.setRenderTarget(null),t.render(o,l)):(t.setRenderTarget(e),t.render(o,l),t.setRenderTarget(n),t.render(o,l)),a.color.setLocked(!1),a.depth.setLocked(!1),a.stencil.setLocked(!1),a.stencil.setFunc(r.EQUAL,1,4294967295),a.stencil.setOp(r.KEEP,r.KEEP,r.KEEP),a.stencil.setLocked(!0)}};function p2(t,e){let n=t.getContext();if(e<=0||typeof n.renderbufferStorageMultisample!="function")return 0;let i=n.getParameter(n.MAX_SAMPLES),s=Math.min(e,i);if(s<=0)return 0;let r=n.getParameter(n.RENDERBUFFER_BINDING),a=n.createRenderbuffer();try{return n.bindRenderbuffer(n.RENDERBUFFER,a),n.renderbufferStorageMultisample(n.RENDERBUFFER,s,n.RGBA8,1,1),s}catch{return 0}finally{n.bindRenderbuffer(n.RENDERBUFFER,r),n.deleteRenderbuffer(a)}}var ag=1/1e3,m2=1e3,g2=class{constructor(){this.startTime=performance.now(),this.previousTime=0,this.currentTime=0,this._delta=0,this._elapsed=0,this._fixedDelta=1e3/60,this.timescale=1,this.useFixedDelta=!1,this._autoReset=!1}get autoReset(){return this._autoReset}set autoReset(t){typeof document<"u"&&document.hidden!==void 0&&(t?document.addEventListener("visibilitychange",this):document.removeEventListener("visibilitychange",this),this._autoReset=t)}get delta(){return this._delta*ag}get fixedDelta(){return this._fixedDelta*ag}set fixedDelta(t){this._fixedDelta=t*m2}get elapsed(){return this._elapsed*ag}update(t){this.useFixedDelta?this._delta=this.fixedDelta:(this.previousTime=this.currentTime,this.currentTime=(t!==void 0?t:performance.now())-this.startTime,this._delta=this.currentTime-this.previousTime),this._delta*=this.timescale,this._elapsed+=this._delta}reset(){this._delta=0,this._elapsed=0,this.currentTime=performance.now()-this.startTime}getDelta(){return this.delta}getElapsed(){return this.elapsed}handleEvent(t){document.hidden||(this.currentTime=performance.now()-this.startTime)}dispose(){this.autoReset=!1}},ug=class{constructor(t=null,{depthBuffer:e=!0,stencilBuffer:n=!1,multisampling:i=0,frameBufferType:s=sn}={}){this.renderer=null,this.inputBuffer=this.createBuffer(e,n,s,i),this.outputBuffer=this.inputBuffer.clone(),this.copyPass=new h2,this.depthRenderTarget=null,this.passes=[],this.timer=new g2,this.autoRenderToScreen=!0,this.setRenderer(t)}get stableDepthTexture(){return this.depthRenderTarget===null?null:this.depthRenderTarget.depthTexture}get multisampling(){return this.inputBuffer.samples}set multisampling(t){let e=this.renderer===null?t:p2(this.renderer,t);this.multisampling!==e&&(this.inputBuffer.samples=e,this.outputBuffer.samples=e,this.inputBuffer.dispose(),this.outputBuffer.dispose())}getTimer(){return this.timer}getRenderer(){return this.renderer}setRenderer(t){if(this.renderer=t,t!==null){let e=t.getSize(new Le),n=t.getContext().getContextAttributes().alpha,i=this.inputBuffer.texture.type;i===sn&&t.outputColorSpace===At&&(this.inputBuffer.texture.colorSpace=At,this.outputBuffer.texture.colorSpace=At,this.inputBuffer.dispose(),this.outputBuffer.dispose());let s=this.multisampling;this.multisampling=s,t.autoClear=!1,this.setSize(e.width,e.height);for(let r of this.passes)r.initialize(t,n,i)}}replaceRenderer(t,e=!0){let n=this.renderer,i=n.domElement.parentNode;return this.setRenderer(t),e&&i!==null&&(i.removeChild(n.domElement),i.appendChild(t.domElement)),n}createDepthTexture(){let t=new cs;t.name="EffectComposer.InputDepth",this.inputBuffer.stencilBuffer?(t.format=tr,t.type=er):t.type=li;let e=new cs;e.format=t.format,e.type=t.type,e.name="EffectComposer.OutputDepth";let n=new cs;n.format=t.format,n.type=t.type,n.name="EffectComposer.StableDepth",this.inputBuffer.depthTexture=t,this.outputBuffer.depthTexture=e,this.inputBuffer.dispose(),this.outputBuffer.dispose();let{width:i,height:s}=this.inputBuffer;this.depthRenderTarget=new qt(i,s,{depthBuffer:!0,stencilBuffer:this.inputBuffer.stencilBuffer,depthTexture:n})}blitDepthBuffer(t){let e=this.renderer,n=this.depthRenderTarget,i=e.properties,s=e.getContext();e.setRenderTarget(n);let r=i.get(t).__webglFramebuffer,a=i.get(n).__webglFramebuffer,o=t.stencilBuffer?s.DEPTH_BUFFER_BIT|s.STENCIL_BUFFER_BIT:s.DEPTH_BUFFER_BIT;s.bindFramebuffer(s.READ_FRAMEBUFFER,r),s.bindFramebuffer(s.DRAW_FRAMEBUFFER,a),s.blitFramebuffer(0,0,t.width,t.height,0,0,n.width,n.height,o,s.NEAREST),s.bindFramebuffer(s.READ_FRAMEBUFFER,null),s.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),e.setRenderTarget(null)}deleteDepthTexture(){let t=this.stableDepthTexture;for(let e of this.passes)e.getDepthTexture()===t&&e.setDepthTexture(null);this.depthRenderTarget!==null&&(this.depthRenderTarget.dispose(),this.depthRenderTarget=null),this.inputBuffer.depthTexture!==null&&(this.inputBuffer.depthTexture.dispose(),this.inputBuffer.depthTexture=null),this.outputBuffer.depthTexture!==null&&(this.outputBuffer.depthTexture.dispose(),this.outputBuffer.depthTexture=null)}createBuffer(t,e,n,i){let s=this.renderer,r=s===null?new Le:s.getDrawingBufferSize(new Le),a=new qt(r.width,r.height,{minFilter:Ht,magFilter:Ht,samples:i,stencilBuffer:e,depthBuffer:t,type:n});return n===sn&&s!==null&&s.outputColorSpace===At&&(a.texture.colorSpace=At),a.texture.name="EffectComposer.Buffer",a.texture.generateMipmaps=!1,a}setMainScene(t){for(let e of this.passes)e.mainScene=t}setMainCamera(t){for(let e of this.passes)e.mainCamera=t}addPass(t,e){let n=this.passes,i=this.renderer,s=i.getDrawingBufferSize(new Le),r=i.getContext().getContextAttributes().alpha,a=this.inputBuffer.texture.type;if(t.renderer=i,t.setSize(s.width,s.height),t.initialize(i,r,a),this.autoRenderToScreen&&(n.length>0&&(n[n.length-1].renderToScreen=!1),t.renderToScreen&&(this.autoRenderToScreen=!1)),e!==void 0?n.splice(e,0,t):n.push(t),this.autoRenderToScreen&&(n[n.length-1].renderToScreen=!0),t.needsDepthTexture||this.depthRenderTarget!==null)if(this.depthRenderTarget===null){this.createDepthTexture();for(let o of n)o.setDepthTexture(this.stableDepthTexture)}else t.setDepthTexture(this.stableDepthTexture)}removePass(t){let e=this.passes,n=e.indexOf(t);if(n!==-1&&e.splice(n,1).length>0){let r=this.stableDepthTexture;if(r!==null){let a=(l,c)=>l||c.needsDepthTexture;e.reduce(a,!1)||(t.getDepthTexture()===r&&t.setDepthTexture(null),this.deleteDepthTexture())}this.autoRenderToScreen&&n===e.length&&(t.renderToScreen=!1,e.length>0&&(e[e.length-1].renderToScreen=!0))}}removeAllPasses(){let t=this.passes;this.deleteDepthTexture(),t.length>0&&(this.autoRenderToScreen&&(t[t.length-1].renderToScreen=!1),this.passes=[])}render(t){let e=this.renderer,n=this.copyPass,i=this.inputBuffer,s=this.outputBuffer,r,a=!1;t===void 0&&(this.timer.update(),t=this.timer.getDelta());for(let o of this.passes)if(o.enabled){if(o.render(e,i,s,t,a),o.needsDepthBlit&&this.depthRenderTarget!==null&&this.blitDepthBuffer(i),o.needsSwap){if(a){n.renderToScreen=o.renderToScreen;let l=e.getContext(),c=e.state.buffers.stencil;c.setFunc(l.NOTEQUAL,1,4294967295),n.render(e,i,s,t,a),c.setFunc(l.EQUAL,1,4294967295)}r=i,i=s,s=r}o instanceof d2?a=!0:o instanceof l2&&(a=!1)}}setSize(t,e,n){let i=this.renderer,s=i.getSize(new Le);(t===void 0||e===void 0)&&(t=s.width,e=s.height),(s.width!==t||s.height!==e)&&i.setSize(t,e,n);let r=i.getDrawingBufferSize(new Le);this.inputBuffer.setSize(r.width,r.height),this.outputBuffer.setSize(r.width,r.height),this.depthRenderTarget!==null&&this.depthRenderTarget.setSize(r.width,r.height);for(let a of this.passes)a.setSize(r.width,r.height)}reset(){this.dispose(),this.autoRenderToScreen=!0}dispose(){for(let t of this.passes)t.dispose();this.deleteDepthTexture(),this.inputBuffer.dispose(),this.outputBuffer.dispose(),this.copyPass.dispose(),this.timer.dispose(),this.passes=[],nr.fullscreenGeometry.dispose()}},Wr={NONE:0,DEPTH:1,CONVOLUTION:2},tt={FRAGMENT_HEAD:"FRAGMENT_HEAD",FRAGMENT_MAIN_UV:"FRAGMENT_MAIN_UV",FRAGMENT_MAIN_IMAGE:"FRAGMENT_MAIN_IMAGE",VERTEX_HEAD:"VERTEX_HEAD",VERTEX_MAIN_SUPPORT:"VERTEX_MAIN_SUPPORT"},v2=class{constructor(){this.shaderParts=new Map([[tt.FRAGMENT_HEAD,null],[tt.FRAGMENT_MAIN_UV,null],[tt.FRAGMENT_MAIN_IMAGE,null],[tt.VERTEX_HEAD,null],[tt.VERTEX_MAIN_SUPPORT,null]]),this.defines=new Map,this.uniforms=new Map,this.blendModes=new Map,this.extensions=new Set,this.attributes=Wr.NONE,this.varyings=new Set,this.uvTransformation=!1,this.readDepth=!1,this.colorSpace=xi}};var og=!1,kA=class{constructor(t=null){this.originalMaterials=new Map,this.material=null,this.materials=null,this.materialsBackSide=null,this.materialsDoubleSide=null,this.materialsFlatShaded=null,this.materialsFlatShadedBackSide=null,this.materialsFlatShadedDoubleSide=null,this.setMaterial(t),this.meshCount=0,this.replaceMaterial=e=>{if(e.isMesh){let n;if(e.material.flatShading)switch(e.material.side){case Sn:n=this.materialsFlatShadedDoubleSide;break;case Gt:n=this.materialsFlatShadedBackSide;break;default:n=this.materialsFlatShaded;break}else switch(e.material.side){case Sn:n=this.materialsDoubleSide;break;case Gt:n=this.materialsBackSide;break;default:n=this.materials;break}this.originalMaterials.set(e,e.material),e.isSkinnedMesh?e.material=n[2]:e.isInstancedMesh?e.material=n[1]:e.material=n[0],++this.meshCount}}}cloneMaterial(t){if(!(t instanceof Qt))return t.clone();let e=t.uniforms,n=new Map;for(let s in e){let r=e[s].value;r.isRenderTargetTexture&&(e[s].value=null,n.set(s,r))}let i=t.clone();for(let s of n)e[s[0]].value=s[1],i.uniforms[s[0]].value=s[1];return i}setMaterial(t){if(this.disposeMaterials(),this.material=t,t!==null){let e=this.materials=[this.cloneMaterial(t),this.cloneMaterial(t),this.cloneMaterial(t)];for(let n of e)n.uniforms=Object.assign({},t.uniforms),n.side=vi;e[2].skinning=!0,this.materialsBackSide=e.map(n=>{let i=this.cloneMaterial(n);return i.uniforms=Object.assign({},t.uniforms),i.side=Gt,i}),this.materialsDoubleSide=e.map(n=>{let i=this.cloneMaterial(n);return i.uniforms=Object.assign({},t.uniforms),i.side=Sn,i}),this.materialsFlatShaded=e.map(n=>{let i=this.cloneMaterial(n);return i.uniforms=Object.assign({},t.uniforms),i.flatShading=!0,i}),this.materialsFlatShadedBackSide=e.map(n=>{let i=this.cloneMaterial(n);return i.uniforms=Object.assign({},t.uniforms),i.flatShading=!0,i.side=Gt,i}),this.materialsFlatShadedDoubleSide=e.map(n=>{let i=this.cloneMaterial(n);return i.uniforms=Object.assign({},t.uniforms),i.flatShading=!0,i.side=Sn,i})}}render(t,e,n){let i=t.shadowMap.enabled;if(t.shadowMap.enabled=!1,og){let s=this.originalMaterials;this.meshCount=0,e.traverse(this.replaceMaterial),t.render(e,n);for(let r of s)r[0].material=r[1];this.meshCount!==s.size&&s.clear()}else{let s=e.overrideMaterial;e.overrideMaterial=this.material,t.render(e,n),e.overrideMaterial=s}t.shadowMap.enabled=i}disposeMaterials(){if(this.material!==null){let t=this.materials.concat(this.materialsBackSide).concat(this.materialsDoubleSide).concat(this.materialsFlatShaded).concat(this.materialsFlatShadedBackSide).concat(this.materialsFlatShadedDoubleSide);for(let e of t)e.dispose()}}dispose(){this.originalMaterials.clear(),this.disposeMaterials()}static get workaroundEnabled(){return og}static set workaroundEnabled(t){og=t}};var Qe={SKIP:9,SET:30,ADD:0,ALPHA:1,AVERAGE:2,COLOR:3,COLOR_BURN:4,COLOR_DODGE:5,DARKEN:6,DIFFERENCE:7,DIVIDE:8,DST:9,EXCLUSION:10,HARD_LIGHT:11,HARD_MIX:12,HUE:13,INVERT:14,INVERT_RGB:15,LIGHTEN:16,LINEAR_BURN:17,LINEAR_DODGE:18,LINEAR_LIGHT:19,LUMINOSITY:20,MULTIPLY:21,NEGATION:22,NORMAL:23,OVERLAY:24,PIN_LIGHT:25,REFLECT:26,SATURATION:27,SCREEN:28,SOFT_LIGHT:29,SRC:30,SUBTRACT:31,VIVID_LIGHT:32},x2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=dst.rgb+src.rgb;return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",y2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){return mix(dst,src,src.a*opacity);}",_2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=(dst.rgb+src.rgb)*0.5;return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",A2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=RGBToHSL(dst.rgb);vec3 b=RGBToHSL(src.rgb);vec3 c=HSLToRGB(vec3(b.xy,a.z));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",S2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=dst.rgb,b=src.rgb;vec3 c=mix(step(0.0,b)*(1.0-min(vec3(1.0),(1.0-a)/max(b,1e-9))),vec3(1.0),step(1.0,a));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",M2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=dst.rgb,b=src.rgb;vec3 c=step(0.0,a)*mix(min(vec3(1.0),a/max(1.0-b,1e-9)),vec3(1.0),step(1.0,b));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",E2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=min(dst.rgb,src.rgb);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",T2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=abs(dst.rgb-src.rgb);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",b2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=dst.rgb/max(src.rgb,1e-9);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",w2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=dst.rgb+src.rgb-2.0*dst.rgb*src.rgb;return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",C2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=min(dst.rgb,1.0);vec3 b=min(src.rgb,1.0);vec3 c=mix(2.0*a*b,1.0-2.0*(1.0-a)*(1.0-b),step(0.5,b));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",R2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=step(1.0,dst.rgb+src.rgb);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",D2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=RGBToHSL(dst.rgb);vec3 b=RGBToHSL(src.rgb);vec3 c=HSLToRGB(vec3(b.x,a.yz));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",U2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=max(1.0-src.rgb,0.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",B2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=src.rgb*max(1.0-dst.rgb,0.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",I2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=max(dst.rgb,src.rgb);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",P2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=clamp(src.rgb+dst.rgb-1.0,0.0,1.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",L2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=min(dst.rgb+src.rgb,1.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",N2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=clamp(2.0*src.rgb+dst.rgb-1.0,0.0,1.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",O2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=RGBToHSL(dst.rgb);vec3 b=RGBToHSL(src.rgb);vec3 c=HSLToRGB(vec3(a.xy,b.z));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",F2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=dst.rgb*src.rgb;return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",z2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=max(1.0-abs(1.0-dst.rgb-src.rgb),0.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",H2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){return mix(dst,src,opacity);}",G2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=2.0*src.rgb*dst.rgb;vec3 b=1.0-2.0*(1.0-src.rgb)*(1.0-dst.rgb);vec3 c=mix(a,b,step(0.5,dst.rgb));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",k2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 src2=2.0*src.rgb;vec3 c=mix(mix(src2,dst.rgb,step(0.5*dst.rgb,src.rgb)),max(src2-1.0,vec3(0.0)),step(dst.rgb,src2-1.0));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",V2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=min(dst.rgb*dst.rgb/max(1.0-src.rgb,1e-9),1.0);vec3 c=mix(a,src.rgb,step(1.0,src.rgb));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",W2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=RGBToHSL(dst.rgb);vec3 b=RGBToHSL(src.rgb);vec3 c=HSLToRGB(vec3(a.x,b.y,a.z));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",X2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=dst.rgb+src.rgb-min(dst.rgb*src.rgb,1.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",Y2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 src2=2.0*src.rgb;vec3 d=dst.rgb+(src2-1.0);vec3 w=step(0.5,src.rgb);vec3 a=dst.rgb-(1.0-src2)*dst.rgb*(1.0-dst.rgb);vec3 b=mix(d*(sqrt(dst.rgb)-dst.rgb),d*dst.rgb*((16.0*dst.rgb-12.0)*dst.rgb+3.0),w*(1.0-step(0.25,dst.rgb)));vec3 c=mix(a,b,w);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",q2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){return src;}",Q2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=max(dst.rgb-src.rgb,0.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",Z2="vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=mix(max(1.0-min((1.0-dst.rgb)/(2.0*src.rgb),1.0),0.0),min(dst.rgb/(2.0*(1.0-src.rgb)),1.0),step(0.5,src.rgb));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}",K2=new Map([[Qe.ADD,x2],[Qe.ALPHA,y2],[Qe.AVERAGE,_2],[Qe.COLOR,A2],[Qe.COLOR_BURN,S2],[Qe.COLOR_DODGE,M2],[Qe.DARKEN,E2],[Qe.DIFFERENCE,T2],[Qe.DIVIDE,b2],[Qe.DST,null],[Qe.EXCLUSION,w2],[Qe.HARD_LIGHT,C2],[Qe.HARD_MIX,R2],[Qe.HUE,D2],[Qe.INVERT,U2],[Qe.INVERT_RGB,B2],[Qe.LIGHTEN,I2],[Qe.LINEAR_BURN,P2],[Qe.LINEAR_DODGE,L2],[Qe.LINEAR_LIGHT,N2],[Qe.LUMINOSITY,O2],[Qe.MULTIPLY,F2],[Qe.NEGATION,z2],[Qe.NORMAL,H2],[Qe.OVERLAY,G2],[Qe.PIN_LIGHT,k2],[Qe.REFLECT,V2],[Qe.SATURATION,W2],[Qe.SCREEN,X2],[Qe.SOFT_LIGHT,Y2],[Qe.SRC,q2],[Qe.SUBTRACT,Q2],[Qe.VIVID_LIGHT,Z2]]),J2=class extends Vn{constructor(t,e=1){super(),this._blendFunction=t,this.opacity=new vt(e)}getOpacity(){return this.opacity.value}setOpacity(t){this.opacity.value=t}get blendFunction(){return this._blendFunction}set blendFunction(t){this._blendFunction=t,this.dispatchEvent({type:"change"})}getBlendFunction(){return this.blendFunction}setBlendFunction(t){this.blendFunction=t}getShaderCode(){return K2.get(this.blendFunction)}};var fg=class extends Vn{constructor(t,e,{attributes:n=Wr.NONE,blendFunction:i=Qe.NORMAL,defines:s=new Map,uniforms:r=new Map,extensions:a=null,vertexShader:o=null}={}){super(),this.name=t,this.renderer=null,this.attributes=n,this.fragmentShader=e,this.vertexShader=o,this.defines=s,this.uniforms=r,this.extensions=a,this.blendMode=new J2(i),this.blendMode.addEventListener("change",l=>this.setChanged()),this._inputColorSpace=xi,this._outputColorSpace=Yn}get inputColorSpace(){return this._inputColorSpace}set inputColorSpace(t){this._inputColorSpace=t,this.setChanged()}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t,this.setChanged()}set mainScene(t){}set mainCamera(t){}getName(){return this.name}setRenderer(t){this.renderer=t}getDefines(){return this.defines}getUniforms(){return this.uniforms}getExtensions(){return this.extensions}getBlendMode(){return this.blendMode}getAttributes(){return this.attributes}setAttributes(t){this.attributes=t,this.setChanged()}getFragmentShader(){return this.fragmentShader}setFragmentShader(t){this.fragmentShader=t,this.setChanged()}getVertexShader(){return this.vertexShader}setVertexShader(t){this.vertexShader=t,this.setChanged()}setChanged(){this.dispatchEvent({type:"change"})}setDepthTexture(t,e=Ni){}update(t,e,n){}setSize(t,e){}initialize(t,e,n){}dispose(){for(let t of Object.keys(this)){let e=this[t];(e instanceof qt||e instanceof yi||e instanceof Yt||e instanceof nr)&&this[t].dispose()}}};var lI=[new Float32Array([0,0]),new Float32Array([0,1,1]),new Float32Array([0,1,1,2]),new Float32Array([0,1,2,2,3]),new Float32Array([0,1,2,3,4,4,5]),new Float32Array([0,1,2,3,4,5,7,8,9,10])];var hg=class extends nr{constructor(t,e,n=null){super("RenderPass",t,e),this.needsSwap=!1,this.needsDepthBlit=!0,this.clearPass=new WA,this.overrideMaterialManager=n===null?null:new kA(n),this.ignoreBackground=!1,this.skipShadowMapUpdate=!1,this.selection=null}set mainScene(t){this.scene=t}set mainCamera(t){this.camera=t}get renderToScreen(){return super.renderToScreen}set renderToScreen(t){super.renderToScreen=t,this.clearPass.renderToScreen=t}get overrideMaterial(){let t=this.overrideMaterialManager;return t!==null?t.material:null}set overrideMaterial(t){let e=this.overrideMaterialManager;t!==null?e!==null?e.setMaterial(t):this.overrideMaterialManager=new kA(t):e!==null&&(e.dispose(),this.overrideMaterialManager=null)}getOverrideMaterial(){return this.overrideMaterial}setOverrideMaterial(t){this.overrideMaterial=t}get clear(){return this.clearPass.enabled}set clear(t){this.clearPass.enabled=t}getSelection(){return this.selection}setSelection(t){this.selection=t}isBackgroundDisabled(){return this.ignoreBackground}setBackgroundDisabled(t){this.ignoreBackground=t}isShadowMapDisabled(){return this.skipShadowMapUpdate}setShadowMapDisabled(t){this.skipShadowMapUpdate=t}getClearPass(){return this.clearPass}render(t,e,n,i,s){let r=this.scene,a=this.camera,o=this.selection,l=a.layers.mask,c=r.background,f=t.shadowMap.autoUpdate,p=this.renderToScreen?null:e;o!==null&&a.layers.set(o.getLayer()),this.skipShadowMapUpdate&&(t.shadowMap.autoUpdate=!1),(this.ignoreBackground||this.clearPass.overrideClearColor!==null)&&(r.background=null),this.clearPass.enabled&&this.clearPass.render(t,e),t.setRenderTarget(p),this.overrideMaterialManager!==null?this.overrideMaterialManager.render(t,r,a):t.render(r,a),a.layers.mask=l,r.background=c,t.shadowMap.autoUpdate=f}};var cI=Math.PI*.5;var j2=`#include <common>
#include <packing>
#include <dithering_pars_fragment>
#define packFloatToRGBA(v) packDepthToRGBA(v)
#define unpackRGBAToFloat(v) unpackRGBAToDepth(v)
#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D inputBuffer;
#else
uniform lowp sampler2D inputBuffer;
#endif
#if DEPTH_PACKING == 3201
uniform lowp sampler2D depthBuffer;
#elif defined(GL_FRAGMENT_PRECISION_HIGH)
uniform highp sampler2D depthBuffer;
#else
uniform mediump sampler2D depthBuffer;
#endif
uniform vec2 resolution;uniform vec2 texelSize;uniform float cameraNear;uniform float cameraFar;uniform float aspect;uniform float time;varying vec2 vUv;vec4 sRGBToLinear(const in vec4 value){return vec4(mix(pow(value.rgb*0.9478672986+vec3(0.0521327014),vec3(2.4)),value.rgb*0.0773993808,vec3(lessThanEqual(value.rgb,vec3(0.04045)))),value.a);}float readDepth(const in vec2 uv){
#if DEPTH_PACKING == 3201
float depth=unpackRGBAToDepth(texture2D(depthBuffer,uv));
#else
float depth=texture2D(depthBuffer,uv).r;
#endif
#if defined(USE_LOGARITHMIC_DEPTH_BUFFER) || defined(LOG_DEPTH)
float d=pow(2.0,depth*log2(cameraFar+1.0))-1.0;float a=cameraFar/(cameraFar-cameraNear);float b=cameraFar*cameraNear/(cameraNear-cameraFar);depth=a+b/d;
#elif defined(USE_REVERSED_DEPTH_BUFFER)
depth=1.0-depth;
#endif
return depth;}float getViewZ(const in float depth){
#ifdef PERSPECTIVE_CAMERA
return perspectiveDepthToViewZ(depth,cameraNear,cameraFar);
#else
return orthographicDepthToViewZ(depth,cameraNear,cameraFar);
#endif
}vec3 RGBToHCV(const in vec3 RGB){vec4 P=mix(vec4(RGB.bg,-1.0,2.0/3.0),vec4(RGB.gb,0.0,-1.0/3.0),step(RGB.b,RGB.g));vec4 Q=mix(vec4(P.xyw,RGB.r),vec4(RGB.r,P.yzx),step(P.x,RGB.r));float C=Q.x-min(Q.w,Q.y);float H=abs((Q.w-Q.y)/(6.0*C+EPSILON)+Q.z);return vec3(H,C,Q.x);}vec3 RGBToHSL(const in vec3 RGB){vec3 HCV=RGBToHCV(RGB);float L=HCV.z-HCV.y*0.5;float S=HCV.y/(1.0-abs(L*2.0-1.0)+EPSILON);return vec3(HCV.x,S,L);}vec3 HueToRGB(const in float H){float R=abs(H*6.0-3.0)-1.0;float G=2.0-abs(H*6.0-2.0);float B=2.0-abs(H*6.0-4.0);return clamp(vec3(R,G,B),0.0,1.0);}vec3 HSLToRGB(const in vec3 HSL){vec3 RGB=HueToRGB(HSL.x);float C=(1.0-abs(2.0*HSL.z-1.0))*HSL.y;return(RGB-0.5)*C+HSL.z;}FRAGMENT_HEAD void main(){FRAGMENT_MAIN_UV vec4 color0=texture2D(inputBuffer,UV);vec4 color1=vec4(0.0);FRAGMENT_MAIN_IMAGE color0.a=clamp(color0.a,0.0,1.0);gl_FragColor=color0;
#ifdef ENCODE_OUTPUT
#include <colorspace_fragment>
#endif
#include <dithering_fragment>
}`,$2="uniform vec2 resolution;uniform vec2 texelSize;uniform float cameraNear;uniform float cameraFar;uniform float aspect;uniform float time;varying vec2 vUv;VERTEX_HEAD void main(){vUv=position.xy*0.5+0.5;VERTEX_MAIN_SUPPORT gl_Position=vec4(position.xy,1.0,1.0);}",eR=class extends Qt{constructor(t,e,n,i,s=!1){super({name:"EffectMaterial",defines:{THREE_REVISION:"180".replace(/\D+/g,""),DEPTH_PACKING:"0",ENCODE_OUTPUT:"1"},uniforms:{inputBuffer:new vt(null),depthBuffer:new vt(null),resolution:new vt(new Le),texelSize:new vt(new Le),cameraNear:new vt(.3),cameraFar:new vt(1e3),aspect:new vt(1),time:new vt(0)},blending:Xn,toneMapped:!1,depthWrite:!1,depthTest:!1,dithering:s}),t&&this.setShaderParts(t),e&&this.setDefines(e),n&&this.setUniforms(n),this.copyCameraSettings(i)}set inputBuffer(t){this.uniforms.inputBuffer.value=t}setInputBuffer(t){this.uniforms.inputBuffer.value=t}get depthBuffer(){return this.uniforms.depthBuffer.value}set depthBuffer(t){this.uniforms.depthBuffer.value=t}get depthPacking(){return Number(this.defines.DEPTH_PACKING)}set depthPacking(t){this.defines.DEPTH_PACKING=t.toFixed(0),this.needsUpdate=!0}setDepthBuffer(t,e=Ni){this.depthBuffer=t,this.depthPacking=e}setShaderData(t){this.setShaderParts(t.shaderParts),this.setDefines(t.defines),this.setUniforms(t.uniforms),this.setExtensions(t.extensions)}setShaderParts(t){return this.fragmentShader=j2.replace(tt.FRAGMENT_HEAD,t.get(tt.FRAGMENT_HEAD)||"").replace(tt.FRAGMENT_MAIN_UV,t.get(tt.FRAGMENT_MAIN_UV)||"").replace(tt.FRAGMENT_MAIN_IMAGE,t.get(tt.FRAGMENT_MAIN_IMAGE)||""),this.vertexShader=$2.replace(tt.VERTEX_HEAD,t.get(tt.VERTEX_HEAD)||"").replace(tt.VERTEX_MAIN_SUPPORT,t.get(tt.VERTEX_MAIN_SUPPORT)||""),this.needsUpdate=!0,this}setDefines(t){for(let e of t.entries())this.defines[e[0]]=e[1];return this.needsUpdate=!0,this}setUniforms(t){for(let e of t.entries())this.uniforms[e[0]]=e[1];return this}setExtensions(t){this.extensions={};for(let e of t)this.extensions[e]=!0;return this}get encodeOutput(){return this.defines.ENCODE_OUTPUT!==void 0}set encodeOutput(t){this.encodeOutput!==t&&(t?this.defines.ENCODE_OUTPUT="1":delete this.defines.ENCODE_OUTPUT,this.needsUpdate=!0)}isOutputEncodingEnabled(t){return this.encodeOutput}setOutputEncodingEnabled(t){this.encodeOutput=t}get time(){return this.uniforms.time.value}set time(t){this.uniforms.time.value=t}setDeltaTime(t){this.uniforms.time.value+=t}adoptCameraSettings(t){this.copyCameraSettings(t)}copyCameraSettings(t){t&&(this.uniforms.cameraNear.value=t.near,this.uniforms.cameraFar.value=t.far,t instanceof dn?this.defines.PERSPECTIVE_CAMERA="1":delete this.defines.PERSPECTIVE_CAMERA,this.needsUpdate=!0)}setSize(t,e){let n=this.uniforms;n.resolution.value.set(t,e),n.texelSize.value.set(1/t,1/e),n.aspect.value=t/e}static get Section(){return tt}};var fI=Number("180".replace(/\D+/g,"")),Vr=255/256,hI=new Float32Array([Vr/256**3,Vr/256**2,Vr/256,Vr]),dI=new Float32Array([Vr,Vr/256,Vr/256**2,1/256**3]);function VA(t,e,n){for(let i of e){let s="$1"+t+i.charAt(0).toUpperCase()+i.slice(1),r=new RegExp("([^\\.])(\\b"+i+"\\b)","g");for(let a of n.entries())a[1]!==null&&n.set(a[0],a[1].replace(r,s))}}function tR(t,e,n){let i=e.getFragmentShader(),s=e.getVertexShader(),r=i!==void 0&&/mainImage/.test(i),a=i!==void 0&&/mainUv/.test(i);if(n.attributes|=e.getAttributes(),i===void 0)throw new Error(`Missing fragment shader (${e.name})`);if(a&&(n.attributes&Wr.CONVOLUTION)!==0)throw new Error(`Effects that transform UVs are incompatible with convolution effects (${e.name})`);if(!r&&!a)throw new Error(`Could not find mainImage or mainUv function (${e.name})`);{let o=/\w+\s+(\w+)\([\w\s,]*\)\s*{/g,l=n.shaderParts,c=l.get(tt.FRAGMENT_HEAD)||"",f=l.get(tt.FRAGMENT_MAIN_UV)||"",p=l.get(tt.FRAGMENT_MAIN_IMAGE)||"",h=l.get(tt.VERTEX_HEAD)||"",d=l.get(tt.VERTEX_MAIN_SUPPORT)||"",y=new Set,_=new Set;if(a&&(f+=`	${t}MainUv(UV);
`,n.uvTransformation=!0),s!==null&&/mainSupport/.test(s)){let g=/mainSupport *\([\w\s]*?uv\s*?\)/.test(s);d+=`	${t}MainSupport(`,d+=g?`vUv);
`:`);
`;for(let v of s.matchAll(/(?:varying\s+\w+\s+([\S\s]*?);)/g))for(let x of v[1].split(/\s*,\s*/))n.varyings.add(x),y.add(x),_.add(x);for(let v of s.matchAll(o))_.add(v[1])}for(let g of i.matchAll(o))_.add(g[1]);for(let g of e.defines.keys())_.add(g.replace(/\([\w\s,]*\)/g,""));for(let g of e.uniforms.keys())_.add(g);_.delete("while"),_.delete("for"),_.delete("if"),e.uniforms.forEach((g,v)=>n.uniforms.set(t+v.charAt(0).toUpperCase()+v.slice(1),g)),e.defines.forEach((g,v)=>n.defines.set(t+v.charAt(0).toUpperCase()+v.slice(1),g));let m=new Map([["fragment",i],["vertex",s]]);VA(t,_,n.defines),VA(t,_,m),i=m.get("fragment"),s=m.get("vertex");let u=e.blendMode;if(n.blendModes.set(u.blendFunction,u),r){e.inputColorSpace!==null&&e.inputColorSpace!==n.colorSpace&&(p+=e.inputColorSpace===At?`color0 = sRGBTransferOETF(color0);
	`:`color0 = sRGBToLinear(color0);
	`),e.outputColorSpace!==Yn?n.colorSpace=e.outputColorSpace:e.inputColorSpace!==null&&(n.colorSpace=e.inputColorSpace);let g=/MainImage *\([\w\s,]*?depth[\w\s,]*?\)/;p+=`${t}MainImage(color0, UV, `,(n.attributes&Wr.DEPTH)!==0&&g.test(i)&&(p+="depth, ",n.readDepth=!0),p+=`color1);
	`;let v=t+"BlendOpacity";n.uniforms.set(v,u.opacity),p+=`color0 = blend${u.blendFunction}(color0, color1, ${v});

	`,c+=`uniform float ${v};

`}if(c+=i+`
`,s!==null&&(h+=s+`
`),l.set(tt.FRAGMENT_HEAD,c),l.set(tt.FRAGMENT_MAIN_UV,f),l.set(tt.FRAGMENT_MAIN_IMAGE,p),l.set(tt.VERTEX_HEAD,h),l.set(tt.VERTEX_MAIN_SUPPORT,d),e.extensions!==null)for(let g of e.extensions)n.extensions.add(g)}}var dg=class extends nr{constructor(t,...e){super("EffectPass"),this.fullscreenMaterial=new eR(null,null,null,t),this.listener=n=>this.handleEvent(n),this.effects=[],this.setEffects(e),this.skipRendering=!1,this.minTime=1,this.maxTime=Number.POSITIVE_INFINITY,this.timeScale=1}set mainScene(t){for(let e of this.effects)e.mainScene=t}set mainCamera(t){this.fullscreenMaterial.copyCameraSettings(t);for(let e of this.effects)e.mainCamera=t}get encodeOutput(){return this.fullscreenMaterial.encodeOutput}set encodeOutput(t){this.fullscreenMaterial.encodeOutput=t}get dithering(){return this.fullscreenMaterial.dithering}set dithering(t){let e=this.fullscreenMaterial;e.dithering=t,e.needsUpdate=!0}setEffects(t){for(let e of this.effects)e.removeEventListener("change",this.listener);this.effects=t.sort((e,n)=>n.attributes-e.attributes);for(let e of this.effects)e.addEventListener("change",this.listener)}updateMaterial(){let t=new v2,e=0;for(let a of this.effects)if(a.blendMode.blendFunction===Qe.DST)t.attributes|=a.getAttributes()&Wr.DEPTH;else{if((t.attributes&a.getAttributes()&Wr.CONVOLUTION)!==0)throw new Error(`Convolution effects cannot be merged (${a.name})`);tR("e"+e++,a,t)}let n=t.shaderParts.get(tt.FRAGMENT_HEAD),i=t.shaderParts.get(tt.FRAGMENT_MAIN_IMAGE),s=t.shaderParts.get(tt.FRAGMENT_MAIN_UV),r=/\bblend\b/g;for(let a of t.blendModes.values())n+=a.getShaderCode().replace(r,`blend${a.blendFunction}`)+`
`;(t.attributes&Wr.DEPTH)!==0?(t.readDepth&&(i=`float depth = readDepth(UV);

	`+i),this.needsDepthTexture=this.getDepthTexture()===null):this.needsDepthTexture=!1,t.colorSpace===At&&(i+=`color0 = sRGBToLinear(color0);
	`),t.uvTransformation?(s=`vec2 transformedUv = vUv;
`+s,t.defines.set("UV","transformedUv")):t.defines.set("UV","vUv"),t.shaderParts.set(tt.FRAGMENT_HEAD,n),t.shaderParts.set(tt.FRAGMENT_MAIN_IMAGE,i),t.shaderParts.set(tt.FRAGMENT_MAIN_UV,s);for(let[a,o]of t.shaderParts)o!==null&&t.shaderParts.set(a,o.trim().replace(/^#/,`
#`));this.skipRendering=e===0,this.needsSwap=!this.skipRendering,this.fullscreenMaterial.setShaderData(t)}recompile(){this.updateMaterial()}getDepthTexture(){return this.fullscreenMaterial.depthBuffer}setDepthTexture(t,e=Ni){this.fullscreenMaterial.depthBuffer=t,this.fullscreenMaterial.depthPacking=e;for(let n of this.effects)n.setDepthTexture(t,e)}render(t,e,n,i,s){for(let r of this.effects)r.update(t,e,i);if(!this.skipRendering||this.renderToScreen){let r=this.fullscreenMaterial;r.inputBuffer=e.texture,r.time+=i*this.timeScale,t.setRenderTarget(this.renderToScreen?null:n),t.render(this.scene,this.camera)}}setSize(t,e){this.fullscreenMaterial.setSize(t,e);for(let n of this.effects)n.setSize(t,e)}initialize(t,e,n){this.renderer=t;for(let i of this.effects)i.initialize(t,e,n);this.updateMaterial(),n!==void 0&&n!==sn&&(this.fullscreenMaterial.defines.FRAMEBUFFER_PRECISION_HIGH="1")}dispose(){super.dispose();for(let t of this.effects)t.removeEventListener("change",this.listener),t.dispose()}handleEvent(t){switch(t.type){case"change":this.recompile();break}}};var mI=[new Float32Array(3),new Float32Array(3)],gI=[new Float32Array(3),new Float32Array(3),new Float32Array(3),new Float32Array(3)],vI=[[new Float32Array([0,0,0]),new Float32Array([1,0,0]),new Float32Array([1,1,0]),new Float32Array([1,1,1])],[new Float32Array([0,0,0]),new Float32Array([1,0,0]),new Float32Array([1,0,1]),new Float32Array([1,1,1])],[new Float32Array([0,0,0]),new Float32Array([0,0,1]),new Float32Array([1,0,1]),new Float32Array([1,1,1])],[new Float32Array([0,0,0]),new Float32Array([0,1,0]),new Float32Array([1,1,0]),new Float32Array([1,1,1])],[new Float32Array([0,0,0]),new Float32Array([0,1,0]),new Float32Array([0,1,1]),new Float32Array([1,1,1])],[new Float32Array([0,0,0]),new Float32Array([0,0,1]),new Float32Array([0,1,1]),new Float32Array([1,1,1])]];var xI=[new Float32Array(2),new Float32Array(2)];var yI=new Float32Array([0,-.25,.25,-.125,.125,-.375,.375]),_I=[new Float32Array([0,0]),new Float32Array([.25,-.25]),new Float32Array([-.25,.25]),new Float32Array([.125,-.125]),new Float32Array([-.125,.125])],AI=[new Uint8Array([0,0]),new Uint8Array([3,0]),new Uint8Array([0,3]),new Uint8Array([3,3]),new Uint8Array([1,0]),new Uint8Array([4,0]),new Uint8Array([1,3]),new Uint8Array([4,3]),new Uint8Array([0,1]),new Uint8Array([3,1]),new Uint8Array([0,4]),new Uint8Array([3,4]),new Uint8Array([1,1]),new Uint8Array([4,1]),new Uint8Array([1,4]),new Uint8Array([4,4])],SI=[new Uint8Array([0,0]),new Uint8Array([1,0]),new Uint8Array([0,2]),new Uint8Array([1,2]),new Uint8Array([2,0]),new Uint8Array([3,0]),new Uint8Array([2,2]),new Uint8Array([3,2]),new Uint8Array([0,1]),new Uint8Array([1,1]),new Uint8Array([0,3]),new Uint8Array([1,3]),new Uint8Array([2,1]),new Uint8Array([3,1]),new Uint8Array([2,3]),new Uint8Array([3,3])];var MI=new Map([[vn(0,0,0,0),new Float32Array([0,0,0,0])],[vn(0,0,0,1),new Float32Array([0,0,0,1])],[vn(0,0,1,0),new Float32Array([0,0,1,0])],[vn(0,0,1,1),new Float32Array([0,0,1,1])],[vn(0,1,0,0),new Float32Array([0,1,0,0])],[vn(0,1,0,1),new Float32Array([0,1,0,1])],[vn(0,1,1,0),new Float32Array([0,1,1,0])],[vn(0,1,1,1),new Float32Array([0,1,1,1])],[vn(1,0,0,0),new Float32Array([1,0,0,0])],[vn(1,0,0,1),new Float32Array([1,0,0,1])],[vn(1,0,1,0),new Float32Array([1,0,1,0])],[vn(1,0,1,1),new Float32Array([1,0,1,1])],[vn(1,1,0,0),new Float32Array([1,1,0,0])],[vn(1,1,0,1),new Float32Array([1,1,0,1])],[vn(1,1,1,0),new Float32Array([1,1,1,0])],[vn(1,1,1,1),new Float32Array([1,1,1,1])]]);function lg(t,e,n){return t+(e-t)*n}function vn(t,e,n,i){let s=lg(t,e,.75),r=lg(n,i,1-.25);return lg(s,r,1-.125)}var ir=ar(ho());var KA=ar(Zl()),sR=()=>{let e=document.createElement("canvas");e.width=64,e.height=64;let n=e.getContext("2d");if(!n)throw new Error("2D context not available");n.fillStyle="black",n.fillRect(0,0,e.width,e.height);let i=new Yt(e);i.minFilter=Ht,i.magFilter=Ht,i.generateMipmaps=!1;let s=[],r=null,a=64,o=.1*64,l=1/a,c=()=>{n.fillStyle="black",n.fillRect(0,0,e.width,e.height)},f=d=>{let y={x:d.x*64,y:(1-d.y)*64},_=1,m=x=>Math.sin(x*Math.PI/2),u=x=>-x*(x-2);d.age<a*.3?_=m(d.age/(a*.3)):_=u(1-(d.age-a*.3)/(a*.7))||0,_*=d.force;let g=`${(d.vx+1)/2*255}, ${(d.vy+1)/2*255}, ${_*255}`,v=320;n.shadowOffsetX=v,n.shadowOffsetY=v,n.shadowBlur=o,n.shadowColor=`rgba(${g},${.22*_})`,n.beginPath(),n.fillStyle="rgba(255,0,0,1)",n.arc(y.x-v,y.y-v,o,0,Math.PI*2),n.fill()};return{canvas:e,texture:i,addTouch:d=>{let y=0,_=0,m=0;if(r){let u=d.x-r.x,g=d.y-r.y;if(u===0&&g===0)return;let v=u*u+g*g,x=Math.sqrt(v);_=u/(x||1),m=g/(x||1),y=Math.min(v*1e4,1)}r={x:d.x,y:d.y},s.push({x:d.x,y:d.y,age:0,force:y,vx:_,vy:m})},update:()=>{c();for(let d=s.length-1;d>=0;d--){let y=s[d],_=y.force*l*(1-y.age/a);y.x+=y.vx*_,y.y+=y.vy*_,y.age++,y.age>a&&s.splice(d,1)}for(let d=0;d<s.length;d++)f(s[d]);i.needsUpdate=!0},set radiusScale(d){o=.1*64*d},get radiusScale(){return o/(.1*64)},size:64}},rR=(t,e)=>{let n=`
    uniform sampler2D uTexture;
    uniform float uStrength;
    uniform float uTime;
    uniform float uFreq;

    void mainUv(inout vec2 uv) {
      vec4 tex = texture2D(uTexture, uv);
      float vx = tex.r * 2.0 - 1.0;
      float vy = tex.g * 2.0 - 1.0;
      float intensity = tex.b;

      float wave = 0.5 + 0.5 * sin(uTime * uFreq + intensity * 6.2831853);

      float amt = uStrength * intensity * wave;

      uv += vec2(vx, vy) * amt;
    }
    `;return new fg("LiquidEffect",n,{uniforms:new Map([["uTexture",new vt(t)],["uStrength",new vt(e?.strength??.025)],["uTime",new vt(0)],["uFreq",new vt(e?.freq??4.5)]])})},QA={square:0,circle:1,triangle:2,diamond:3},aR=`
void main() {
  gl_Position = vec4(position, 1.0);
}
`,oR=`
precision highp float;

uniform vec3  uColor;
uniform vec2  uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uScale;
uniform float uDensity;
uniform float uPixelJitter;
uniform int   uEnableRipples;
uniform float uRippleSpeed;
uniform float uRippleThickness;
uniform float uRippleIntensity;
uniform float uEdgeFade;

uniform int   uShapeType;
const int SHAPE_SQUARE   = 0;
const int SHAPE_CIRCLE   = 1;
const int SHAPE_TRIANGLE = 2;
const int SHAPE_DIAMOND  = 3;

const int   MAX_CLICKS = 10;

uniform vec2  uClickPos  [MAX_CLICKS];
uniform float uClickTimes[MAX_CLICKS];

out vec4 fragColor;

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2. + a.y * a.y * .75);
}
#define Bayer4(a) (Bayer2(.5*(a))*0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(.5*(a))*0.25 + Bayer2(a))

#define FBM_OCTAVES     5
#define FBM_LACUNARITY  1.25
#define FBM_GAIN        1.0

float hash11(float n){ return fract(sin(n)*43758.5453); }

float vnoise(vec3 p){
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n100 = hash11(dot(ip + vec3(1.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n010 = hash11(dot(ip + vec3(0.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n110 = hash11(dot(ip + vec3(1.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n001 = hash11(dot(ip + vec3(0.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n101 = hash11(dot(ip + vec3(1.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n011 = hash11(dot(ip + vec3(0.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  float n111 = hash11(dot(ip + vec3(1.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  vec3 w = fp*fp*fp*(fp*(fp*6.0-15.0)+10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0  = mix(x00, x10, w.y);
  float y1  = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(vec2 uv, float t){
  vec3 p = vec3(uv * uScale, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < FBM_OCTAVES; ++i){
    sum  += amp * vnoise(p * freq);
    freq *= FBM_LACUNARITY;
    amp  *= FBM_GAIN;
  }
  return sum * 0.5 + 0.5;
}

float maskCircle(vec2 p, float cov){
  float r = sqrt(cov) * .25;
  float d = length(p - 0.5) - r;
  float aa = 0.5 * fwidth(d);
  return cov * (1.0 - smoothstep(-aa, aa, d * 2.0));
}

float maskTriangle(vec2 p, vec2 id, float cov){
  bool flip = mod(id.x + id.y, 2.0) > 0.5;
  if (flip) p.x = 1.0 - p.x;
  float r = sqrt(cov);
  float d  = p.y - r*(1.0 - p.x);
  float aa = fwidth(d);
  return cov * clamp(0.5 - d/aa, 0.0, 1.0);
}

float maskDiamond(vec2 p, float cov){
  float r = sqrt(cov) * 0.564;
  return step(abs(p.x - 0.49) + abs(p.y - 0.49), r);
}

void main(){
  float pixelSize = uPixelSize;
  vec2 fragCoord = gl_FragCoord.xy - uResolution * .5;
  float aspectRatio = uResolution.x / uResolution.y;

  vec2 pixelId = floor(fragCoord / pixelSize);
  vec2 pixelUV = fract(fragCoord / pixelSize);

  float cellPixelSize = 8.0 * pixelSize;
  vec2 cellId = floor(fragCoord / cellPixelSize);
  vec2 cellCoord = cellId * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

  float base = fbm2(uv, uTime * 0.05);
  base = base * 0.5 - 0.65;

  float feed = base + (uDensity - 0.5) * 0.3;

  float speed     = uRippleSpeed;
  float thickness = uRippleThickness;
  const float dampT     = 1.0;
  const float dampR     = 10.0;

  if (uEnableRipples == 1) {
    for (int i = 0; i < MAX_CLICKS; ++i){
      vec2 pos = uClickPos[i];
      if (pos.x < 0.0) continue;
      float cellPixelSize = 8.0 * pixelSize;
      vec2 cuv = (((pos - uResolution * .5 - cellPixelSize * .5) / (uResolution))) * vec2(aspectRatio, 1.0);
      float t = max(uTime - uClickTimes[i], 0.0);
      float r = distance(uv, cuv);
      float waveR = speed * t;
      float ring  = exp(-pow((r - waveR) / thickness, 2.0));
      float atten = exp(-dampT * t) * exp(-dampR * r);
      feed = max(feed, ring * atten * uRippleIntensity);
    }
  }

  float bayer = Bayer8(fragCoord / uPixelSize) - 0.5;
  float bw = step(0.5, feed + bayer);

  float h = fract(sin(dot(floor(fragCoord / uPixelSize), vec2(127.1, 311.7))) * 43758.5453);
  float jitterScale = 1.0 + (h - 0.5) * uPixelJitter;
  float coverage = bw * jitterScale;
  float M;
  if      (uShapeType == SHAPE_CIRCLE)   M = maskCircle (pixelUV, coverage);
  else if (uShapeType == SHAPE_TRIANGLE) M = maskTriangle(pixelUV, pixelId, coverage);
  else if (uShapeType == SHAPE_DIAMOND)  M = maskDiamond(pixelUV, coverage);
  else                                   M = coverage;

  if (uEdgeFade > 0.0) {
    vec2 norm = gl_FragCoord.xy / uResolution;
    float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
    float fade = smoothstep(0.0, uEdgeFade, edge);
    M *= fade;
  }

  vec3 color = uColor;

  // sRGB gamma correction - convert linear to sRGB for accurate color output
  vec3 srgbColor = mix(
    color * 12.92,
    1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
    step(0.0031308, color)
  );

  fragColor = vec4(srgbColor, M);
}
`,pg=10,lR=({variant:t="square",pixelSize:e=3,color:n="#B497CF",className:i,style:s,antialias:r=!0,patternScale:a=2,patternDensity:o=1,liquid:l=!1,liquidStrength:c=.1,liquidRadius:f=1,pixelSizeJitter:p=0,enableRipples:h=!0,rippleIntensityScale:d=1,rippleThickness:y=.1,rippleSpeed:_=.3,liquidWobbleSpeed:m=4.5,autoPauseOffscreen:u=!0,speed:g=.5,transparent:v=!0,edgeFade:x=.5,noiseAmount:T=0})=>{let C=(0,ir.useRef)(null),w=(0,ir.useRef)({visible:!0}),D=(0,ir.useRef)(g),E=(0,ir.useRef)(null),M=(0,ir.useRef)(null);return(0,ir.useEffect)(()=>{let U=C.current;if(!U)return;D.current=g;let G=["antialias","liquid","noiseAmount"],V={antialias:r,liquid:l,noiseAmount:T},Y=!1;if(!E.current)Y=!0;else if(M.current){for(let O of G)if(M.current[O]!==V[O]){Y=!0;break}}if(Y){if(E.current){let le=E.current;le.resizeObserver?.disconnect(),cancelAnimationFrame(le.raf),le.quad?.geometry.dispose(),le.material.dispose(),le.composer?.dispose(),le.renderer.dispose(),le.renderer.forceContextLoss(),le.renderer.domElement.parentElement===U&&U.removeChild(le.renderer.domElement),E.current=null}let O=document.createElement("canvas"),N=new lh({canvas:O,antialias:r,alpha:!0,powerPreference:"high-performance"});N.domElement.style.width="100%",N.domElement.style.height="100%",N.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),U.appendChild(N.domElement),v?N.setClearAlpha(0):N.setClearColor(0,1);let J={uResolution:{value:new Le(0,0)},uTime:{value:0},uColor:{value:new qe(n)},uClickPos:{value:Array.from({length:pg},()=>new Le(-1,-1))},uClickTimes:{value:new Float32Array(pg)},uShapeType:{value:QA[t]??0},uPixelSize:{value:e*N.getPixelRatio()},uScale:{value:a},uDensity:{value:o},uPixelJitter:{value:p},uEnableRipples:{value:h?1:0},uRippleSpeed:{value:_},uRippleThickness:{value:y},uRippleIntensity:{value:d},uEdgeFade:{value:x}},k=new Qs,se=new Js(-1,1,1,-1,0,1),pe=new Qt({vertexShader:aR,fragmentShader:oR,uniforms:J,transparent:!0,depthTest:!1,depthWrite:!1,glslVersion:Yl}),Me=new Pr(2,2),Fe=new mn(Me,pe);k.add(Fe);let rt=new zl,ht=()=>{let le=U.clientWidth||1,re=U.clientHeight||1;N.setSize(le,re,!1),J.uResolution.value.set(N.domElement.width,N.domElement.height),E.current?.composer&&E.current.composer.setSize(N.domElement.width,N.domElement.height),J.uPixelSize.value=e*N.getPixelRatio()};ht();let Je=new ResizeObserver(ht);Je.observe(U);let K=(()=>{if(typeof window<"u"&&window.crypto?.getRandomValues){let le=new Uint32Array(1);return window.crypto.getRandomValues(le),le[0]/4294967295}return Math.random()})()*1e3,oe,Te,ve;if(l){Te=sR(),Te.radiusScale=f,oe=new ug(N);let le=new hg(k,se);ve=rR(Te.texture,{strength:c,freq:m});let re=new dg(se,ve);re.renderToScreen=!0,oe.addPass(le),oe.addPass(re)}if(T>0){oe||(oe=new ug(N),oe.addPass(new hg(k,se)));let le=new fg("NoiseEffect","uniform float uTime; uniform float uAmount; float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453);} void mainUv(inout vec2 uv){} void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){ float n=hash(floor(uv*vec2(1920.0,1080.0))+floor(uTime*60.0)); float g=(n-0.5)*uAmount; outputColor=inputColor+vec4(vec3(g),0.0);} ",{uniforms:new Map([["uTime",new vt(0)],["uAmount",new vt(T)]])}),re=new dg(se,le);re.renderToScreen=!0,oe&&oe.passes.length>0&&oe.passes.forEach(Ze=>Ze.renderToScreen=!1),oe.addPass(re)}oe&&oe.setSize(N.domElement.width,N.domElement.height);let ke=le=>{let re=N.domElement.getBoundingClientRect(),Ze=N.domElement.width/re.width,de=N.domElement.height/re.height,Ie=(le.clientX-re.left)*Ze,Nt=(re.height-(le.clientY-re.top))*de;return{fx:Ie,fy:Nt,w:N.domElement.width,h:N.domElement.height}},Jt=le=>{let{fx:re,fy:Ze}=ke(le),de=E.current?.clickIx??0;J.uClickPos.value[de].set(re,Ze),J.uClickTimes.value[de]=J.uTime.value,E.current&&(E.current.clickIx=(de+1)%pg)},R=le=>{if(!Te)return;let{fx:re,fy:Ze,w:de,h:Ie}=ke(le);Te.addTouch({x:re/de,y:Ze/Ie})};N.domElement.addEventListener("pointerdown",Jt,{passive:!0}),N.domElement.addEventListener("pointermove",R,{passive:!0});let $e=0,Be=()=>{if(E.current){if(u&&!w.current.visible){$e=requestAnimationFrame(Be),E.current&&(E.current.raf=$e);return}J.uTime.value=K+rt.getElapsedTime()*D.current,ve&&(ve.uniforms.get("uTime").value=J.uTime.value),oe?(Te&&Te.update(),oe.passes.forEach(le=>{let re=le.effects;re&&re.forEach(Ze=>{let de=Ze.uniforms?.get("uTime");de&&(de.value=J.uTime.value)})}),oe.render()):N.render(k,se),$e=requestAnimationFrame(Be),E.current&&(E.current.raf=$e)}};$e=requestAnimationFrame(Be),E.current&&(E.current.raf=$e),E.current={renderer:N,scene:k,camera:se,material:pe,clock:rt,clickIx:0,uniforms:J,resizeObserver:Je,raf:$e,quad:Fe,timeOffset:K,composer:oe,touch:Te,liquidEffect:ve}}else{let O=E.current;if(O.uniforms.uShapeType.value=QA[t]??0,O.uniforms.uPixelSize.value=e*O.renderer.getPixelRatio(),O.uniforms.uColor.value.set(n),O.uniforms.uScale.value=a,O.uniforms.uDensity.value=o,O.uniforms.uPixelJitter.value=p,O.uniforms.uEnableRipples.value=h?1:0,O.uniforms.uRippleIntensity.value=d,O.uniforms.uRippleThickness.value=y,O.uniforms.uRippleSpeed.value=_,O.uniforms.uEdgeFade.value=x,v?O.renderer.setClearAlpha(0):O.renderer.setClearColor(0,1),O.liquidEffect){let N=O.liquidEffect;N&&(N.value=c);let J=O.liquidEffect.uniforms.get("uFreq");J&&(J.value=m)}O.touch&&(O.touch.radiusScale=f)}return M.current=V,()=>{if(!E.current)return;let O=E.current;O.resizeObserver?.disconnect(),cancelAnimationFrame(O.raf),O.quad?.geometry.dispose(),O.material.dispose(),O.composer?.dispose(),O.renderer.dispose(),O.renderer.forceContextLoss(),O.renderer.domElement.parentElement===U&&U.removeChild(O.renderer.domElement),E.current=null}},[r,l,T,e,a,o,h,d,y,_,p,x,v,c,f,m,u,t,n,g]),(0,KA.jsx)("div",{ref:C,className:`pixel-blast-container ${i??""}`,style:s,"aria-label":"PixelBlast interactive background"})},ZA=lR;var mg=ar(Zl());function cR({container:t,color:e="#97cdcf",patternDensity:n=1.25}){let[i,s]=(0,hh.useState)(!document.hidden);return(0,hh.useEffect)(()=>{let r=!0,a=()=>s(r&&!document.hidden),o=new IntersectionObserver(l=>{r=l.some(c=>c.isIntersecting),a()});return o.observe(t),document.addEventListener("visibilitychange",a),()=>{o.disconnect(),document.removeEventListener("visibilitychange",a)}},[t]),i?(0,mg.jsx)(ZA,{color:e,patternScale:8,patternDensity:n,speed:1,pixelSize:4,edgeFade:.25,variant:"square",liquid:!1,noiseAmount:0}):null}window.YanPixelBlast={mount(t,e={}){let n=(0,JA.createRoot)(t);return n.render((0,mg.jsx)(cR,{container:t,...e})),()=>n.unmount()}};})();
/*! For license information please see site-pixel-blast.js.LEGAL.txt */

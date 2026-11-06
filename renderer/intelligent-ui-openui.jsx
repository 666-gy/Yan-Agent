import React from 'react';
import {createRoot} from 'react-dom/client';
import {Renderer} from '@openuidev/react-lang';
import {ThemeProvider} from '@openuidev/react-ui';
import {makeCatalog} from '../lib/intelligent-ui/catalog.cjs';
import {translator} from '../lib/intelligent-ui/i18n.cjs';
import {mountLegacy} from './intelligent-ui/legacy.jsx';
import {createPanelSession} from './intelligent-ui/session.js';
import {MapView} from './intelligent-ui/map.jsx';
import './intelligent-ui/openui.css';

const library = makeCatalog(MapView);
class PanelBoundary extends React.Component {
  state = {error:false};
  static getDerivedStateFromError(){return {error:true};}
  componentDidCatch(){parent.postMessage({type:'error'}, '*');}
  render(){return this.state.error?<p role="alert">{this.props.message}</p>:this.props.children;}
}
function mount(code,lang,title) {
  // Historical programs keep their original component signatures and state schema.
  if (/\bApp\s*\(/.test(code.replace(/"(?:\\.|[^"\\])*"/g, '""'))) return mountLegacy(code,lang,title);
  const t = translator(lang);
  const element = document.createElement('main'); element.className='yan-ui-program';
  const notice = document.createElement('p'); notice.className='yan-ui-save'; notice.setAttribute('role','status'); notice.hidden=true;
  document.body.append(element,notice);
  const session = createPanelSession(window.yanUi, {
    onSummary:text => parent.postMessage({type:'summary',text}, '*'),
    onSave:ok => {notice.hidden=ok;notice.textContent=ok?'':t('save.unavailable');notice.dataset.saved=String(ok);}
  });
  const mode = getComputedStyle(document.documentElement).colorScheme==='dark'?'dark':'light';
  const font='"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
  const tokens = {fontBody:font,fontHeading:font,fontLabel:font,fontNumbers:font,
    textBodyDefault:'400 14px/1.55 '+font,textBodySm:'400 12px/1.5 '+font,textBodyLg:'400 16px/1.5 '+font,
    textBodyDefaultHeavy:'600 14px/1.55 '+font,textBodyLgHeavy:'600 20px/1.4 '+font,
    background:'transparent',textNeutralPrimary:'var(--ui-text)',textNeutralSecondary:'var(--ui-muted)',borderDefault:'var(--ui-border)',interactiveAccentDefault:'var(--ui-accent)'};
  createRoot(element).render(<PanelBoundary message={t('status.runtimeError')}><ThemeProvider mode={mode} lightTheme={tokens} darkTheme={tokens}>
    <Renderer response={code} library={library} initialState={session.initial} onStateUpdate={session.update}
      toolProvider={null} publishObservability={false}
      onAction={() => { /* Local OpenUI actions never dispatch work or submit chat. */ }}
      onError={errors => {if(errors?.length){console.warn('OpenUI runtime:',errors);parent.postMessage({type:'error'}, '*');}}}/>
  </ThemeProvider></PanelBoundary>);
  addEventListener('pagehide',()=>session.dispose(),{once:true});
}
window.YanOpenUi={mount};

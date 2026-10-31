'use strict';
document.documentElement.classList.add('js');
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const brl = value => value.toLocaleString('pt-BR', {style:'currency',currency:'BRL'});

// Code-native layered sculpture: each ring is part of the same twisted surface.
const layers = $('#vaseLayers');
const svgNS = 'http://www.w3.org/2000/svg';
const ring = (t, inset = 0) => {
  const y = 393 - t * 315;
  const width = 66 + 25 * Math.sin(t * Math.PI) + 28 * Math.exp(-(((t-.68)/.24)**2)) - 18 * Math.exp(-(((t-.9)/.12)**2)) - inset;
  const depth = width*.37;
  const twist = t*1.15;
  return Array.from({length:12},(_,j)=>{const a=j/12*Math.PI*2+twist;return [210+Math.cos(a)*width, y+Math.sin(a)*depth];});
};
for(let i=0;i<92;i++){
  const t=i/92, lower=ring(t),upper=ring((i+1)/92);
  for(let j=0;j<12;j++){
    const next=(j+1)%12,poly=document.createElementNS(svgNS,'polygon');
    poly.setAttribute('points',[lower[j],lower[next],upper[next],upper[j]].map(p=>p.join(',')).join(' '));
    const angle=(j+.5)/12*Math.PI*2+t*1.15;
    const light=Math.round(48+13*Math.cos(angle-4));
    poly.setAttribute('fill',`hsl(${254+Math.round(t*6)} 92% ${light}%)`);
    poly.setAttribute('stroke',`hsl(253 88% ${light-4}%)`);
    poly.setAttribute('stroke-width','.45');
    layers.append(poly);
  }
}
const topRing = document.createElementNS(svgNS,'path');
const outer=ring(1), inner=ring(1,10);
topRing.setAttribute('d','M'+outer.map(p=>p.join(',')).join('L')+'ZM'+inner.reverse().map(p=>p.join(',')).join('L')+'Z');
topRing.setAttribute('fill','url(#vaseTop)');topRing.setAttribute('fill-rule','evenodd');layers.append(topRing);
const hole=document.createElementNS(svgNS,'polygon');hole.setAttribute('points',ring(1,11).map(p=>p.join(',')).join(' '));hole.setAttribute('fill','#211052');layers.insertBefore(hole,topRing);

// Scroll remains native; animation work is batched into one frame.
let scrollFrame=0;
function scrollUpdate(){
  const y=window.scrollY;
  const max=document.documentElement.scrollHeight-innerHeight;
  $('.scroll-progress').style.transform=`scaleX(${max>0?y/max:0})`;
  $('.header').classList.toggle('scrolled',y>15);
  if(!reduced && innerWidth>650 && y<900) $('.hero-art').style.setProperty('--art-y',`${y*.09}px`);
  scrollFrame=0;
}
addEventListener('scroll',()=>{if(!scrollFrame)scrollFrame=requestAnimationFrame(scrollUpdate);},{passive:true});
addEventListener('resize',scrollUpdate);scrollUpdate();
const revealObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');revealObserver.unobserve(e.target);}}),{threshold:.09,rootMargin:'0px 0px -25px 0px'});
$$('.reveal').forEach(el=>revealObserver.observe(el));
$$('.benefit-grid .reveal,.plan-grid .reveal').forEach((el,i)=>el.style.transitionDelay=`${(i%3)*80}ms`);
const flowSteps=$$('.flow-step'),nodes=$$('.flow-node');
function activateStep(i){flowSteps.forEach((el,n)=>el.classList.toggle('active',n===i));nodes.forEach((el,n)=>el.classList.toggle('active',n===i));$('#flow-current').textContent=String(i+1).padStart(2,'0');$('#flow-progress').style.width=`${(i+1)*25}%`;}
activateStep(0);
const flowObserver=new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting);if(visible.length)activateStep(Number(visible.sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0].target.dataset.step));},{rootMargin:'-15% 0px -35% 0px',threshold:[0,.15,.4,.65]});
flowSteps.forEach(el=>flowObserver.observe(el));
const navObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){$$('.desktop-nav a').forEach(a=>a.classList.toggle('active',a.hash==='#'+e.target.id));}}),{rootMargin:'-15% 0px -65% 0px'});
$$('#funcionalidades,#fluxo,#planos,#duvidas').forEach(el=>navObserver.observe(el));
if(finePointer&&!reduced){
  addEventListener('pointermove',e=>{const light=$('.pointer-light');light.style.left=e.clientX+'px';light.style.top=e.clientY+'px';},{passive:true});
  $$('.tilt-card').forEach(card=>{card.addEventListener('pointermove',e=>{const r=card.getBoundingClientRect();card.style.setProperty('--rx',`${-(e.clientY-r.top-r.height/2)/r.height*5}deg`);card.style.setProperty('--ry',`${(e.clientX-r.left-r.width/2)/r.width*5}deg`);});card.addEventListener('pointerleave',()=>{card.style.setProperty('--rx','0deg');card.style.setProperty('--ry','0deg');});});
  $$('.magnetic').forEach(button=>{button.addEventListener('pointermove',e=>{const r=button.getBoundingClientRect();button.style.transform=`translate(${(e.clientX-r.left-r.width/2)*.08}px,${(e.clientY-r.top-r.height/2)*.12}px)`;});button.addEventListener('pointerleave',()=>button.style.transform='');});
}

// Responsive navigation.
const menu=$('.menu-toggle'),mobile=$('#mobile-nav');
function closeMenu(){menu.setAttribute('aria-expanded','false');mobile.hidden=true;}
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')==='true';menu.setAttribute('aria-expanded',String(!open));mobile.hidden=open;});
$$('a,button',mobile).forEach(el=>el.addEventListener('click',closeMenu));
addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});

// A real local demo: slider math uses the displayed purchase-price reference.
let priceFrame=0,currentFilament=10.5;
function updatePrice(){
  const weight=Number($('#weight').value),target=weight*1.05*.1;
  $('#weight-value').textContent=weight;
  $('#weight').style.background=`linear-gradient(to right,var(--purple) ${(weight-20)/280*100}%,#ececf6 ${(weight-20)/280*100}%)`;
  cancelAnimationFrame(priceFrame);
  const start=currentFilament,time=performance.now();
  function frame(now){const progress=reduced?1:Math.min(1,(now-time)/180);currentFilament=start+(target-start)*(1-(1-progress)**3);$('#filament-cost').textContent=brl(currentFilament);$('#cost-total').textContent=brl(currentFilament+9);$('#suggested').textContent=brl((currentFilament+9)*2);if(progress<1)priceFrame=requestAnimationFrame(frame);}
  priceFrame=requestAnimationFrame(frame);
}
$('#weight').addEventListener('input',updatePrice);
const tabTitles={pricing:['MEU ATELIÊ / PRECIFICAÇÃO','Quanto vale sua criação?'],stock:['MEU ATELIÊ / MATERIAIS','Sua bancada, organizada.'],orders:['MEU ATELIÊ / PEDIDOS','Cada criação tem um caminho.']};
$$('.app-tab').forEach(tab=>{tab.setAttribute('aria-controls','panel-'+tab.dataset.tab);tab.setAttribute('aria-pressed',String(tab.classList.contains('active')));tab.addEventListener('click',()=>{const key=tab.dataset.tab;$$('.app-tab').forEach(t=>{t.classList.toggle('active',t===tab);t.setAttribute('aria-pressed',String(t===tab));});$$('.tab-panel').forEach(p=>{p.hidden=p.id!=='panel-'+key;p.classList.remove('panel-in');});const panel=$('#panel-'+key);void panel.offsetWidth;panel.classList.add('panel-in');$('#app-breadcrumb').textContent=tabTitles[key][0];$('#app-title').textContent=tabTitles[key][1];});});
let toastTimeout;
function toast(message){const el=$('.toast');clearTimeout(toastTimeout);$('p',el).textContent=message;el.classList.add('visible');toastTimeout=setTimeout(()=>el.classList.remove('visible'),4300);}
$('.demo-save').addEventListener('click',()=>toast('Exemplo calculado! Na versão real, ele fica no seu histórico.'));
let orderStage=0;
const order=$('#interactive-order'),columns=$$('.kanban-col'),advance=$('#advance-order');
function renderOrder(){columns[orderStage].append(order);$('#count-quoted').textContent=orderStage===0?'1':'0';$('#count-paid').textContent=orderStage===1?'1':'0';$('#count-delivered').textContent=orderStage===2?'2':'1';$('#empty-paid').hidden=orderStage===1;advance.disabled=orderStage===2;advance.innerHTML=orderStage===0?'Marcar como pago <span>→</span>':orderStage===1?'Marcar como entregue <span>→</span>':'Pedido entregue <span>✓</span>';order.classList.remove('panel-in');void order.offsetWidth;order.classList.add('panel-in');}
advance.addEventListener('click',()=>{if(orderStage<2){orderStage++;renderOrder();toast(orderStage===1?'Pagamento registrado neste exemplo.':'Mais uma criação entregue! Esta é uma simulação.');}});
$('#reset-order').addEventListener('click',()=>{orderStage=0;renderOrder();});

// Manual versus integrated filling: same purpose, different path.
const modeCopy={manual:{badge:'PREENCHIMENTO MANUAL',title:'Você informa.<br>O Hub calcula.',description:'Preencha os parâmetros da máquina, o preço do filamento e o custo das embalagens em cada cálculo. Um jeito simples de começar, sem cadastrar insumos.',foot:'Sua precificadora, mesmo sem cadastros de materiais.',fields:['Informe os parâmetros da máquina','Informe o preço e o peso do filamento','Informe o custo da embalagem']},integrated:{badge:'PREENCHIMENTO INTEGRADO',title:'Seus cadastros.<br>Prontos para calcular.',description:'Selecione sua impressora, o carretel e as embalagens. As referências cadastradas chegam ao cálculo, sem repetir o preenchimento.',foot:'Menos repetição a cada nova precificação.',fields:['Creality K1 · Perfil cadastrado','PLA Violeta · Carretel cadastrado','Caixa kraft · Material cadastrado']}};
$$('[data-mode]').forEach(button=>button.addEventListener('click',()=>{const mode=button.dataset.mode,data=modeCopy[mode];$$('[data-mode]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-selected',String(b===button));});$('.compare-toggle').classList.toggle('manual',mode==='manual');const panel=$('#mode-demo');panel.classList.toggle('manual',mode==='manual');panel.setAttribute('aria-labelledby',button.id);$('#mode-badge').textContent=data.badge;$('#mode-title').innerHTML=data.title;$('#mode-description').textContent=data.description;$('#mode-foot').textContent=data.foot;['printer','filament','packaging'].forEach((key,i)=>{$('#mode-'+key).textContent=data.fields[i];$('#mode-'+key+'-icon').textContent=mode==='manual'?'+':'✓';});$('.compare-fields').classList.remove('field-swap');void $('.compare-fields').offsetWidth;$('.compare-fields').classList.add('field-swap');}));
$('#compare-expand').addEventListener('click',()=>{const open=$('#compare-expand').getAttribute('aria-expanded')==='true';$('#detailed-comparison').hidden=open;$('#compare-expand').setAttribute('aria-expanded',String(!open));$('#compare-expand').innerHTML=(open?'Comparar todos os recursos':'Fechar comparação')+' <span>'+(open?'＋':'−')+'</span>';if(!open)$('#detailed-comparison').classList.add('panel-in');});

// Accessible native details with a measured closing animation.
$$('.faq-list details').forEach(detail=>{
  const summary=$('summary',detail),answer=$('.faq-answer',detail);
  let closing=false;
  const setOpen=open=>{if(reduced){detail.open=open;return;}if(open){detail.open=true;answer.style.height='0px';requestAnimationFrame(()=>answer.style.height=answer.scrollHeight+'px');setTimeout(()=>{if(detail.open&&!closing)answer.style.height='auto';},370);}else{closing=true;answer.style.height=answer.scrollHeight+'px';requestAnimationFrame(()=>answer.style.height='0px');setTimeout(()=>{detail.open=false;answer.style.height='';closing=false;},350);}};
  detail.closeAnimated=()=>{if(detail.open&&!closing)setOpen(false);};
  summary.addEventListener('click',e=>{e.preventDefault();if(closing)return;if(!detail.open){$$('.faq-list details').filter(d=>d!==detail).forEach(d=>d.closeAnimated?.());setOpen(true);}else setOpen(false);});
});

// Preview calls-to-action are explicit about not creating accounts or charges.
const dialog=$('#preview-dialog');
function openDialog(plan){const login=plan==='login';$('#dialog-title').textContent=login?'Seu espaço de criação.':plan==='Aprendiz'?'Toda jornada tem uma primeira camada.':'Sua operação, mais conectada.';$('#dialog-description').textContent=login?'Aqui será a entrada para sua conta Modulus Hub. Nesta prévia, você pode explorar a demonstração e conhecer os planos.':plan==='Aprendiz'?'O Aprendiz é o plano gratuito para começar a precificar com dados manuais e organizar seus primeiros produtos e pedidos.':'O Visionário reúne seus cadastros no cálculo e traz mais espaço para organizar a sua operação.';$('#dialog-plan-info').textContent=login?'':plan==='Aprendiz'?'Grátis · 1 master · 3 produtos · 3 pedidos no total':'R$ 39,90/mês · 1 master + 1 operador · 15 materiais compartilhados';dialog.showModal();document.body.style.overflow='hidden';}
$$('[data-plan]').forEach(button=>button.addEventListener('click',()=>openDialog(button.dataset.plan)));
$$('[data-open=login]').forEach(button=>button.addEventListener('click',()=>openDialog('login')));
function closeDialog(){dialog.close();}
$('.dialog-close').addEventListener('click',closeDialog);$('.dialog-confirm').addEventListener('click',closeDialog);
dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();});
dialog.addEventListener('close',()=>document.body.style.overflow='');

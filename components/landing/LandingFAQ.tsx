import { Asterisk } from "lucide-react";
import { LandingFAQItem } from "./LandingFAQItem";
export default function LandingFAQ() { return (
<section className="ml-faq ml-section-pad" id="duvidas"><div className="ml-container ml-faq-layout"><div className="ml-faq-intro ml-reveal"><div className="ml-eyebrow">SEM PONTAS SOLTAS</div><h2>Vamos tirar<br />suas dúvidas<span className="ml-orange-dot">?</span></h2><p>O que você precisa saber antes de dar o próximo passo.</p><div className="ml-faq-decoration" aria-hidden="true"><Asterisk size="1em" strokeWidth={1.75} aria-hidden="true" /></div></div><div className="ml-faq-list ml-reveal">
<LandingFAQItem title={<> Posso começar sem pagar? </>}> <p>Sim. O Aprendiz é gratuito, com precificadora manual, um owner e até três produtos históricos e três pedidos históricos. Não exige cartão para começar.</p> </LandingFAQItem>
<LandingFAQItem title={<> O que muda na precificadora do Visionário? </>}> <p>No Aprendiz, você preenche os parâmetros manualmente. No Visionário, seleciona impressoras, carretéis e materiais já cadastrados para carregar suas referências no cálculo. A integração é entre os cadastros do Hub.</p> </LandingFAQItem>
<LandingFAQItem title={<> O Hub se conecta fisicamente à impressora? </>}> <p>Não nesta versão. O cadastro guarda os parâmetros da máquina para ajudar na precificação. Não há telemetria, monitoramento de camadas ou controle remoto da impressora.</p> </LandingFAQItem>
<LandingFAQItem title={<> Os 15 materiais incluem os carretéis? </>}> <p>Sim. No Visionário, carretéis e materiais gerais compartilham quinze cadastros. Por exemplo: dez carretéis e cinco materiais de embalagem. O saldo de cada item é controlado separadamente.</p> </LandingFAQItem>
<LandingFAQItem title={<> O que acontece quando cancelo o plano? </>}> <p>O acesso retorna ao gratuito imediatamente. Os dados são preservados, mas impressoras, carretéis e materiais ficam indisponíveis. Você acessa os três últimos produtos e pedidos registrados. O operador perde o acesso empresarial até a regularização.</p> </LandingFAQItem>
<LandingFAQItem title={<> Quando o Magnata estará disponível? </>}> <p>O Magnata está em desenvolvimento para uma próxima fase, com preço planejado de R$ 79,90/mês e escopo a confirmar. Ainda não pode ser contratado e não há cobrança antecipada.</p> </LandingFAQItem>
</div></div></section>
); }

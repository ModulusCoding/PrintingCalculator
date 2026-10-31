"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { searchProductsAction } from "@/lib/pricing/persistence-actions";
import { saveOrderAction, type SaveOrderResult } from "@/lib/orders/write-actions";
import type { OrderDetail, OrderItem } from "@/lib/orders/actions";
import { brValue, cents, decimalBR, estimate, formatCents, orderInputSchema, type OrderInput } from "@/lib/orders/write-schema";

type Line = { key: string; origin: "catalog" | "custom"; product_id: string | null; name: string; description: string; quantity: string; price: string; mode: "untracked" | "stock" | "make_to_order" };
const blank = (): Line => ({ key:crypto.randomUUID(), origin:"custom", product_id:null, name:"", description:"", quantity:"1", price:"0,00", mode:"untracked" });
const inputClass = "w-full rounded-lg border border-[#c7c4d9] bg-white px-3 py-2 text-sm text-[#152336] focus:border-[#5852ff] focus:outline-none";
const sectionClass = "space-y-4 rounded-xl border border-[#c7c4d9] bg-white p-5 shadow-xs";

export function OrderForm({ initial, initialItems = [], physical }: { initial?: OrderDetail; initialItems?: OrderItem[]; physical: boolean }) {
  const [buyer, setBuyer] = useState({name:initial?.buyerName || "", phone:initial?.buyerPhone || "", email:initial?.buyerEmail || "", address:initial?.buyerAddress || "", notes:initial?.notes || ""});
  const [lines, setLines] = useState<Line[]>(() => initialItems.map(i => ({key:i.id, origin:i.origin as Line["origin"], product_id:i.productId, name:i.name, description:i.description || "", quantity:String(i.quantity), price:brValue(i.unitPrice), mode:i.fulfillmentMode as Line["mode"]})));
  const [discountType, setDiscountType] = useState<"fixed" | "percent">((initial?.discountType as "fixed" | "percent") || "fixed");
  const [discount, setDiscount] = useState(brValue(initial?.discountInput ?? 0));
  const [shipping, setShipping] = useState(brValue(initial?.shippingAmount ?? 0));
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const attempt = useRef<{payload:string; id:string} | null>(null);
  const [result, setResult] = useState<SaveOrderResult | null>(null);
  const [localError, setLocalError] = useState("");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<{id:string; name:string; price:number|null}[]>([]);
  const [productPage, setProductPage] = useState(1);
  const [productPages, setProductPages] = useState(1);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchSequence = useRef(0);
  // An uncertain outcome may already be committed: only exact retransmission is safe.
  const locked = busy || result?.ok === true || (result?.ok === false && result.uncertain === true);

  function itemPayload(): OrderInput["items"] { return lines.map(i => ({origin:i.origin, product_id:i.product_id, name:i.name.trim(), description:i.description || null, quantity:i.quantity, unit_price:decimalBR(i.price), fulfillment_mode:i.mode})); }
  let preview: ReturnType<typeof estimate> | null = null;
  try {
    if (lines.length && lines.every(i => /^[1-9]\d*$/.test(i.quantity))) preview = estimate({items:itemPayload(), discountType, discountInput:decimalBR(discount), shippingAmount:decimalBR(shipping)});
  } catch { /* Incomplete input is not a valid estimate. */ }

  function patch(key:string, changes:Partial<Line>) { setLines(current => current.map(i => i.key === key ? {...i, ...changes} : i)); }
  async function search(page = 1, value = query) {
    const seq = ++searchSequence.current;
    setSearchBusy(true); setSearchError("");
    try {
      const r = await searchProductsAction({query:value, page, limit:10});
      if (seq !== searchSequence.current) return;
      if (r.ok) {setProducts(r.data.items); setProductPage(r.data.page); setProductPages(r.data.totalPages); setSearchedQuery(value);}
      else {setProducts([]); setSearchError(r.error);}
    } catch { if (seq === searchSequence.current) { setProducts([]); setSearchError("Não foi possível consultar os produtos."); } }
    finally {if (seq === searchSequence.current) setSearchBusy(false);}
  }
  async function submit(e:React.FormEvent) {
    e.preventDefault();
    if (guard.current || result?.ok) return;
    setLocalError("");
    try {
      const payload = {buyerName:buyer.name.trim(), buyerPhone:buyer.phone || null, buyerEmail:buyer.email || null, buyerAddress:buyer.address || null, notes:buyer.notes || null,
        items:itemPayload(), discountType, discountInput:decimalBR(discount), shippingAmount:decimalBR(shipping),
        ...(initial ? {orderId:initial.id, expectedVersion:initial.version} : {})};
      const serialized = JSON.stringify(payload);
      if (attempt.current?.payload !== serialized) attempt.current = {payload:serialized, id:crypto.randomUUID()};
      const validated = orderInputSchema.safeParse({...payload, attemptId:attempt.current.id});
      if (!validated.success) {setLocalError("Revise os campos: " + validated.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).slice(0,3).join("; ")); return;}
      guard.current = true; setBusy(true);
      try {
        const saved = await saveOrderAction(validated.data);
        setResult(saved);
        // Stay on the receipt to show authoritative amounts; links load revalidated readers.
      } catch {setResult({ok:false, code:"technical", uncertain:true, message:"Resultado não confirmado. Repita sem alterar os dados ou confira a listagem antes de iniciar outra operação."});}
      finally {guard.current = false; setBusy(false);}
    } catch (error) {setLocalError(error instanceof Error ? error.message : "Revise os valores.");}
  }

  return <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
    <fieldset disabled={locked} className="min-w-0 space-y-6 disabled:opacity-70">
      <section className={sectionClass}>
        <h2 className="font-bold text-[#152336]">Comprador</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">Nome *<input required maxLength={255} className={inputClass} value={buyer.name} onChange={e=>setBuyer({...buyer,name:e.target.value})}/></label>
          <label className="text-sm">Telefone<input maxLength={50} className={inputClass} value={buyer.phone} onChange={e=>setBuyer({...buyer,phone:e.target.value})}/></label>
          <label className="text-sm">E-mail<input type="email" maxLength={320} className={inputClass} value={buyer.email} onChange={e=>setBuyer({...buyer,email:e.target.value})}/></label>
          <label className="text-sm">Endereço<textarea maxLength={2000} className={inputClass} value={buyer.address} onChange={e=>setBuyer({...buyer,address:e.target.value})}/></label>
        </div>
      </section>
      <section className={sectionClass}>
        <h2 className="font-bold text-[#152336]">Itens do pedido</h2>
        <p className="text-xs text-[#464556]">Preços negociados e dados do comprador pertencem a este pedido. Produtos são confirmados novamente ao salvar.</p>
        <div className="rounded-lg bg-[#f8f9fa] p-3 space-y-3">
          <label className="block text-sm">Localizar produto cadastrado<input maxLength={200} className={inputClass} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nome do produto"/></label>
          <button type="button" disabled={searchBusy} onClick={()=>search()} className="text-sm font-semibold text-[#3d32e6]">{searchBusy ? "Buscando…" : "Buscar produtos"}</button>
          {searchError && <p role="alert" className="text-sm text-red-700">{searchError}</p>}
          {products.map(p=><div key={p.id} className="flex items-center justify-between gap-3 border-t border-[#c7c4d9] py-2 text-sm">
            <span>{p.name}{p.price !== null && ` — ${formatCents(BigInt(Math.round(p.price * 100)))}`}</span>
            <button type="button" disabled={lines.length>=100} onClick={()=>setLines([...lines,{...blank(), origin:"catalog", product_id:p.id, name:p.name, price:brValue(p.price ?? 0)}])} className="font-semibold text-[#3d32e6]">Adicionar</button>
          </div>)}
          {products.length > 0 && <div className="flex justify-between text-xs"><button type="button" disabled={searchBusy || productPage<=1} onClick={()=>search(productPage-1,searchedQuery)}>Anterior</button><span>{productPage}/{productPages}</span><button type="button" disabled={searchBusy || productPage>=productPages} onClick={()=>search(productPage+1,searchedQuery)}>Próxima</button></div>}
          {!searchBusy && searchedQuery && !searchError && products.length===0 && <p className="text-xs">Nenhum produto disponível nesta busca.</p>}
          <p className="text-xs text-[#464556]">Somente produtos ativos e visíveis no seu plano. No Aprendiz, a janela é de três produtos, sem controles físicos.</p>
        </div>
        {lines.map((i,index)=><div key={i.key} className="space-y-3 rounded-lg border border-[#c7c4d9] p-3">
          <div className="flex justify-between text-xs font-semibold"><span>Item {index+1} · {i.origin === "catalog" ? "Produto cadastrado" : "Personalizado"}</span><button type="button" onClick={()=>setLines(lines.filter(l=>l.key!==i.key))} className="text-red-700">Remover</button></div>
          <label className="block text-sm">Nome *<input required readOnly={i.origin==="catalog"} maxLength={255} className={inputClass} value={i.name} onChange={e=>patch(i.key,{name:e.target.value})}/></label>
          {i.origin === "custom" && <label className="block text-sm">Descrição<textarea maxLength={3000} className={inputClass} value={i.description} onChange={e=>patch(i.key,{description:e.target.value})}/></label>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Quantidade *<input required inputMode="numeric" pattern="[1-9][0-9]*" className={inputClass} value={i.quantity} onChange={e=>patch(i.key,{quantity:e.target.value})}/></label>
            <label className="text-sm">Preço unitário (R$) *<input required inputMode="decimal" className={inputClass} value={i.price} onChange={e=>patch(i.key,{price:e.target.value})}/></label>
          </div>
          {physical && !initial && i.origin === "catalog" && <label className="block text-sm">Atendimento<select className={inputClass} value={i.mode} onChange={e=>patch(i.key,{mode:e.target.value as Line["mode"]})}><option value="untracked">Sem integração física</option><option value="stock">Estoque (reserva integral se disponível)</option><option value="make_to_order">Encomenda</option></select></label>}
          {i.mode === "stock" && <p className="text-xs text-[#464556]">Saldo insuficiente converte as linhas deste produto em encomenda, sem reserva parcial. A confirmação ocorre ao salvar.</p>}
          <p className="text-right text-xs">Subtotal estimado: {(()=>{try{return /^[1-9]\d*$/.test(i.quantity) ? formatCents(BigInt(i.quantity)*BigInt(decimalBR(i.price).replace(".",""))) : "—";}catch{return "—";}})()}</p>
        </div>)}
        <button type="button" disabled={lines.length>=100} onClick={()=>setLines([...lines,blank()])} className="rounded-lg border border-[#c7c4d9] px-3 py-2 text-sm font-semibold text-[#3d32e6]">Adicionar item personalizado</button>
        {initial && <p className="text-xs text-[#464556]">Ao salvar, todos os itens acima substituem a coleção atual. Pedidos com reservas ou histórico físico não permitem edição.</p>}
      </section>
      <section className={sectionClass}><h2 className="font-bold">Observações</h2><textarea aria-label="Observações" maxLength={5000} className={inputClass} value={buyer.notes} onChange={e=>setBuyer({...buyer,notes:e.target.value})}/></section>
    </fieldset>
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
      <section className={sectionClass}>
        <h2 className="font-bold">Resumo comercial estimado</h2>
        <fieldset disabled={locked} className="space-y-3">
          <label className="block text-sm">Desconto<select className={inputClass} value={discountType} onChange={e=>{setDiscountType(e.target.value as "fixed"|"percent");setDiscount("0,00");}}><option value="fixed">Valor fixo (R$)</option><option value="percent">Percentual (%)</option></select></label>
          <label className="block text-sm">{discountType === "fixed" ? "Valor (R$)" : "Percentual (%)"}<input required inputMode="decimal" className={inputClass} value={discount} onChange={e=>setDiscount(e.target.value)}/></label>
          <label className="block text-sm">Frete (R$)<input required inputMode="decimal" className={inputClass} value={shipping} onChange={e=>setShipping(e.target.value)}/></label>
        </fieldset>
        <p className="text-xs text-[#464556]">Desconto sobre os itens, sem incluir frete. Percentual arredondado a centavos; valor fixo limitado ao subtotal.</p>
        {preview ? <dl className="space-y-2 text-sm">{[["Subtotal",preview.subtotal],["Desconto",preview.discount],["Frete",preview.shipping],["Total estimado",preview.total]].map(([label,value])=><div key={String(label)} className="flex justify-between"><dt>{String(label)}</dt><dd className="font-semibold">{formatCents(value as bigint)}</dd></div>)}</dl> : <p className="text-sm">Preencha os itens e valores para visualizar a estimativa.</p>}
        {localError && <p role="alert" className="text-sm text-red-700">{localError}</p>}
        {result && !result.ok && <div role="alert" className="space-y-2 text-sm text-red-700"><p>{result.message}</p>{result.uncertain && <p>Não altere os dados antes de confirmar o resultado: uma nova tentativa pode criar outro pedido.</p>}{result.code==="version_conflict" && <button type="button" className="underline" onClick={()=>{if(window.confirm("Descartar suas alterações e carregar a versão atual?")) window.location.reload();}}>Recarregar dados</button>}</div>}
        {result?.ok ? <div role="status" className="space-y-3 text-sm text-emerald-800"><p className="font-bold">Pedido #{result.data.display_number} salvo · versão {result.data.version}</p><p>Subtotal: {formatCents(cents(result.data.subtotal))}</p><p>Desconto: {formatCents(cents(result.data.discount_amount))}</p><p>Frete: {formatCents(cents(result.data.shipping_amount))}</p><p>Total confirmado: {formatCents(cents(result.data.total_amount))}</p><Link className="block font-semibold underline" href={`/admin/orders?orderId=${result.data.order_id}`}>Ver pedido e financeiro atualizados</Link></div> : <button disabled={busy || result?.code==="version_conflict" || result?.code==="idempotency_conflict"} className="w-full rounded-lg bg-[#5852ff] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Salvando…" : initial ? "Salvar alterações" : "Criar pedido"}</button>}
        <Link href="/admin/orders" className="block text-center text-sm text-[#464556]">{result?.ok ? "Voltar aos pedidos" : "Cancelar / conferir listagem"}</Link>
      </section>
    </aside>
  </form>;
}

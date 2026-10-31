export function formatGrams(value:number|string){return `${new Intl.NumberFormat("pt-BR",{maximumFractionDigits:3}).format(Number(value))} g`;}
export function formatCurrency(value:number|string){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(value));}
export function formatPercent(value:number|string){return `${new Intl.NumberFormat("pt-BR",{maximumFractionDigits:1}).format(Number(value))}%`;}
export function formatDate(value:string){return new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date(value));}

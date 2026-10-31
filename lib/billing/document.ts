/** Numeric CPF/CNPJ check digits only; not proof of identity/registration. */
export function validBillingDocument(value: string): boolean {
  if (!/^(?:\d{11}|\d{14})$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const digits = [...value].map(Number);
  const size = digits.length === 11 ? 9 : 12;
  const check = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      const weight = size === 9 ? length + 1 - i : ((length - 1 - i) % 8) + 2;
      sum += digits[i] * weight;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digits[size] === check(size) && digits[size + 1] === check(size + 1);
}

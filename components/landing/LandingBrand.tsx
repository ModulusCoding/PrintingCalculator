import Image from "next/image";

/** Official brand asset, shared by the public navigation and product preview. */
export default function LandingBrand() {
  return (
    <span className="ml-official-brand">
      <Image src="/logo_Horizontal.svg" alt="Modulus" width={184} height={38} />
      <span className="ml-hub-tag">hub</span>
    </span>
  );
}

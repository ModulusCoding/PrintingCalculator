import Link from "next/link";
import CalculateButton from "./components/CalculateButton";

export default function Home() {
  return (
    <main>
      <h1>Hello World</h1>
      <CalculateButton />
    <Link href="/contact">Contact</Link>
    </main>
    
  );
}

"use client";

import dynamic from "next/dynamic";
import type { Spool3DProps } from "./Spool3D";

const DetailModel = dynamic(() => import("./Spool3D").then(module => module.Spool3D), {
  ssr: false,
  loading: () => <p role="status">Carregando visualização 3D…</p>,
});

/** Only the authorized detail route mounts this lazy client boundary. */
export function SpoolDetail3D(props: Spool3DProps) {
  return <DetailModel {...props} interactive />;
}

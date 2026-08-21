/** Mount the global hub (pill + drawer) once into #sshxl-aa-root. */

import { render } from "preact";
import { Hub } from "./Hub";

const ROOT_ID = "sshxl-aa-root";

export function mountHub(): () => void {
  const mount = (): void => {
    document.getElementById(ROOT_ID)?.remove();
    const root = document.createElement("div");
    root.id = ROOT_ID;
    document.body.appendChild(root);
    render(<Hub />, root);
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
  return () => {
    const root = document.getElementById(ROOT_ID);
    if (root) {
      render(null, root);
      root.remove();
    }
  };
}

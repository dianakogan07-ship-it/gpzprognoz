import type { SVGProps } from "react";

const base = (d: string) => function Icon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d={d} />
    </svg>
  );
};

export const IconUpload = base("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12");
export const IconDownload = base("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3");
export const IconLock = base("M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4");
export const IconFile = base("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2");
export const IconPlay = base("M5 3l14 9-14 9z");
export const IconPlus = base("M12 5v14M5 12h14");
export const IconEdit = base("M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z");
export const IconTrash = base("M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6");
export const IconCheck = base("M20 6L9 17l-5-5");
export const IconX = base("M18 6L6 18M6 6l12 12");
export const IconHelp = base("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01");
export const IconLogout = base("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9");

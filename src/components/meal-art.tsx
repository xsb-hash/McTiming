export function MealArt({ small = false }: { small?: boolean }) {
  return <svg className={small ? "meal-art small" : "meal-art"} viewBox="0 0 460 330" role="img" aria-label="汉堡、饮品和薯条的餐品示意插画">
    <ellipse cx="225" cy="282" rx="202" ry="24" fill="#ddd5bc" opacity=".5" />
    <g transform="rotate(8 350 165)"><path d="M325 70h72l-9 172h-53z" fill="#f5be26" /><path d="M319 65h84v17h-84z" fill="#faf8ef" stroke="#282b25" strokeWidth="4" /><path d="M361 64V22h32" fill="none" stroke="#282b25" strokeWidth="7" /><path d="M330 128h62l-4 79h-54z" fill="#fff8dd" /><circle cx="362" cy="164" r="18" fill="#e9a822" /></g>
    <g transform="rotate(-8 70 195)"><path d="M34 121v96m22-108v108m23-104v104m23-83v83m-67-62h68" stroke="#e4a82b" strokeWidth="13" /><path d="M22 177h92l-10 90H34z" fill="#bd4b32" /><path d="M22 177q46 32 92 0" fill="#f8ce43" /><path d="M48 229h40" stroke="#fff1c3" strokeWidth="6" /></g>
    <path d="M104 172c1-70 52-107 106-107s107 40 109 107z" fill="#e8a847" stroke="#b97832" strokeWidth="3" /><path d="M131 141c18-35 46-52 74-53" fill="none" stroke="#f7cb78" strokeWidth="12" strokeLinecap="round" /><path d="m174 107 7-5m46-5 7 4m35 24 7 5m-69-4 7 2" stroke="#fff0bf" strokeWidth="5" strokeLinecap="round" />
    <path d="M105 177q18-17 35-2t35 0t35 0t35 0t35 0t36 2v15H105z" fill="#6a8145" /><rect x="103" y="189" width="215" height="29" rx="14" fill="#64402b" /><path d="m109 188 62 3 38 23 37-24h64" fill="#fbd260" /><path d="M108 222h207q0 48-103 48t-104-48" fill="#e8a847" stroke="#b97832" strokeWidth="3" /><path d="M111 228h199" stroke="#f7cb78" strokeWidth="7" />
  </svg>;
}

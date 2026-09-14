import { useState } from "react";
import {
  littlePersonId,
  type LittlePersonId,
  type LittlePersonNamespace,
} from "./little-person-map";
import "./little-person.css";

const head = '<path d="M-9-5c-5-15 16-19 21-7 5 14-15 23-21 7Z" fill="var(--person-fill)"/><path d="m-1-9 .1.1m7-1 .1.1m-5 7 4-1"/>';
const body = '<path d="m-5 5-5 29q12 6 26-1L9 4" fill="var(--person-fill)"/><path d="m-3 20 9 1" stroke="var(--person-accent)" stroke-width="6"/>';
const legs = '<path d="m-7 35-9 24-9 1m37-26 8 24 10 1"/>';
const path = (value: string) => `<path d="${value}"/>`;
const prop = (value: string) => `<g class="person-prop">${value}</g>`;
const star = (x: number, y: number) =>
  `<path d="m${x} ${y} 2 6 7 2-6 2-2 7-3-6-7-3 7-2z"/>`;
const human = (
  arms: string,
  x = 88,
  y = 65,
  lower = legs,
  extra = "",
) => `<g transform="translate(${x} ${y})"><g class="person-body">${head}${body}${lower}<g class="person-hand">${arms}</g>${extra}</g></g>`;

// 来自已确认的 little-people.js，内容全为仓库内静态 SVG，不包含用户输入。
const drawings: Record<LittlePersonId, string> = {
  wave: human(path("m-5 10-21 4-5-10m39 7 17-15-2-17m-4 1 3-7m3 5 2-5m-1 8 6-2")) + prop(path("m126 27 5-4m-3 16 8-1")),
  stretch: human(path("m-5 9-23-21-5-19m41 40 22-24 3-19")) + prop(path("m42 27-7-4m-1 15-7 1m108-16 7-3")),
  read: human(path("m-5 11-9 9 15 2m10-12 13 7-7 7"), 74, 62) + prop('<path d="m62 75 27 5 22-8 4 27-24 7-28-5zM89 80l2 26" fill="var(--person-fill)"/>'),
  sit: path("M57 101h83m-73 0-6 24m67-24 5 25") + human(path("m-6 10-6 18 15 4m9-23 12 11 14-4"), 88, 61, path("m-5 35 28 5 6 23 10 1m-29-29 17 5 7 17 10 1")),
  flower: human(path("m-5 11-19 20-12 2m43-23 18 12 9-16"), 71, 66) + prop(path("M127 92q-5-31 6-48m-7 26q-15-10-17-3 3 11 17 11") + '<path d="M130 45c-21 2-20-16-8-13-8-15 9-18 12-6 9-14 21-3 11 6 17 4 8 21-5 12-1 13-16 11-10 1Z" fill="var(--person-accent)"/>'),
  balloon: human(path("m-5 11-18 17-10-2m41-15 23-10 9-22"), 74, 68) + prop(path("M120 68q-13-15 6-27") + '<path d="M126 41c-35-18-12-45 7-28 23-12 31 16-7 28Z" fill="var(--person-accent)"/>'),
  dance: human(path("m-5 9-23-14-8 4m44 12 25-17 7-14"), 87, 56, path("m-7 34-12 25-13-4m46-20 25 10 10-7")) + prop(path("M133 68v17m0-15 12-4v15m-12 4c-11-3-11 10 0 5m12-8c-9-4-12 9 0 5")),
  walk: human(path("m-4 9-17 22-7 1m37-21 19 9 10-1"), 92, 65, path("m-7 34-21 20-11-1m50-18 14 25 12-2")) + prop(path("m39 76-15 1m11 9-17 1")),
  nap: path("M33 103h122m-110 0-4 20m101-21 4 20") + human(path("m-5 10 22 11 15-4m-19-6 14 9 5-12"), 67, 62, path("m-7 34 40 3 16 18 17 1m-54-20 44-1 13 15 9-2")) + prop(path("m135 38 10-1-9 11 12-1m-18-23 9-1-7 8 9-1")),
  umbrella: human(path("m-5 11-17 15-7-4m37-11 15 11 10-6"), 77, 70) + prop('<path d="M49 43q39-49 80-1c-10-7-19-6-24 0-8-7-16-7-24 1-10-8-20-7-32 0Z" fill="var(--person-accent)"/>' + path("m88 19 4 2m-1 20 4 51q1 14 12 2")),
  highfive: human(path("m-5 10-20 20m33-18 26-31 4-13"), 58, 67) + human(path("m-5 10-24-30-4-11m43 44 19 16"), 133, 66),
  balance: human(path("m-5 10-35 1-8-4m57 4 30-5 7-6"), 94, 59, path("m-7 35 8 29-9 1m21-30 19 13-26 5")) + prop(star(143, 31)),
  kite: human(path("m-5 10-12 13 10 2m16-14 19-19 6-8"), 59, 69) + prop('<path d="m137 12 30 24-21 30-27-24z" fill="var(--person-accent)"/>' + path("m137 12 9 54m-27-24 48-6M141 67q-35 25-65 7m-2 0 7 5-8 5")),
  skate: human(path("m-5 10-26 6-8-6m48 2 25-12 10 5"), 91, 57, path("m-7 35-24 21-7-2m49-19 22 21 10-2")) + prop(path("M46 119q41 7 92-1") + '<circle cx="60" cy="127" r="4"/><circle cx="125" cy="127" r="4"/>'),
  music: human(path("m-5 10-19-7 5-11m28 19 18-11-4-14")) + prop(path("M73 58c-7-40 39-42 38-6M73 52l-2 10m38-12 1 10m25 15V59l12-3v16") + '<ellipse cx="130" cy="76" rx="5" ry="3"/>'),
  hug: human(path("m-5 11-16 14 21 6m10-20 17 14-20 7"), 87, 61) + prop('<path d="M86 88c-26-26 0-37 7-22 12-17 36 3-7 22Z" fill="var(--person-accent)"/>'),
  star: human(path("m-5 11-27 7-9-5m50-3 18-27-2-16"), 87, 66) + prop(star(117, 20) + star(152, 47)),
  water: human(path("m-5 11 11 16 20-7m-17-6 13 6 11-7"), 61, 65) + prop('<path d="m129 101 32-1-4 23-25 1z" fill="var(--person-accent)"/>' + path("m145 101-2-21q-18-26-21-9 0 11 21 9 13-32 24-17 3 11-23 25M87 85l17-5 6 15-17 6zM105 85l19-5 4 6m-19 0 13-3m5 8 2 3m7-1 2 4")),
  steps: path("M84 126v-15h25V91h29V72h32") + human(path("m-5 10-23 12-10-4m41-8 16-17 11 1"), 83, 53, path("m-7 35 5 24 10 1m2-25 21 1 8 6")),
  swing: path("M30 125 49 15h101l22 110M71 17v83m55-83v83") + prop(human(path("m-5 10-17 10-1-15m31 5 13 8 3-16"), 95, 58, path("m-7 35-2 22 11 5m11-27-1 23 11 4")) + path("M67 100h64")),
  roll: human(path("m-5 11 19 8 17 9m-22-15 15 10 9 11"), 56, 62) + prop('<circle cx="134" cy="94" r="28" fill="var(--person-accent)"/>' + path("m115 91 14 9 20-15")),
  float: prop('<path d="M48 107c-26-6-17-31 5-24 0-24 31-31 41-12 18-26 42-12 40 7 31-3 44 29 8 34Z" fill="var(--person-accent)"/>') + human(path("m-5 10-21 7-10-9m43 3 20 12 10-6"), 90, 44, path("m-7 35-7 16 13 5m15-22 13 14 9-7")),
  carry: human(path("m-5 11-11 13 8 9m18-21 16 15-12 6"), 88, 59) + prop('<path d="m63 82 46-2 3 28-46 1zM63 82l9-10 44 1-7 7m7-7-4 35" fill="var(--person-fill)"/>' + path("m81 84 12-1m-9 10 10-1")),
  paint: human(path("m-5 11-20 16 2 7m34-22 21 5 11-14"), 62, 65) + prop('<path d="m117 36 43 2-5 57-44-2Z" fill="var(--person-fill)"/>' + path("m124 95-8 28m30-28 11 29m-30-56q12-18 22 0m-20 7 15 2m-38-17 13-18")),
};

export function LittlePerson({
  namespace,
  businessId,
  className = "",
}: {
  namespace: LittlePersonNamespace;
  businessId: number;
  className?: string;
}) {
  const [pulse, setPulse] = useState(0);
  const person = littlePersonId(namespace, businessId);

  return <span
    className={`little-person-host ${className}`.trim()}
    aria-hidden="true"
    onPointerUp={() => {
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setPulse((value) => value + 1);
      }
    }}
  >
    <svg
      key={pulse}
      className={`little-person${pulse > 0 ? " person-tapped" : ""}`}
      data-person={person}
      viewBox="0 0 200 140"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path className="person-ground" d="M25 125q70 3 146-1" />
      <g dangerouslySetInnerHTML={{ __html: drawings[person] }} />
    </svg>
  </span>;
}

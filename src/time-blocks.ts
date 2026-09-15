import type { TimeBlockCategory, TimeBlockTemplate } from "./markdown";
import sunriseBackground from "./assets/sunrise.svg";
import officeBackground from "./assets/office.svg";
import openBackground from "./assets/open-space.svg";

export const DEFAULT_TIME_BLOCKS: readonly TimeBlockTemplate[] = [
  {
    id: "morning-joy",
    startTime: "06:45",
    endTime: "08:10",
    title: "清晨美好瞬间",
    categories: ["美好瞬间"],
    background: sunriseBackground,
  },
  {
    id: "morning-minimum",
    startTime: "09:00",
    endTime: "10:30",
    title: "上午RY最低及格线",
    categories: ["日常事务"],
    background: officeBackground,
  },
  {
    id: "late-morning-joy",
    startTime: "10:30",
    endTime: "12:00",
    title: "上午美好瞬间",
    categories: ["美好瞬间"],
    background: sunriseBackground,
  },
  {
    id: "afternoon-minimum",
    startTime: "13:00",
    endTime: "14:30",
    title: "下午RY最低及格线",
    categories: ["日常事务"],
    background: officeBackground,
  },
  {
    id: "afternoon-open-1",
    startTime: "14:30",
    endTime: "15:30",
    title: "留白上半场",
    categories: ["美好瞬间", "日常事务"],
    background: openBackground,
  },
  {
    id: "daily-work",
    startTime: "15:30",
    endTime: "17:00",
    title: "日常事务",
    categories: ["日常事务"],
    background: officeBackground,
  },
  {
    id: "afternoon-open-2",
    startTime: "17:00",
    endTime: "18:00",
    title: "留白下半场",
    categories: ["美好瞬间", "日常事务"],
    background: openBackground,
  },
];

export type { TimeBlockCategory, TimeBlockTemplate };

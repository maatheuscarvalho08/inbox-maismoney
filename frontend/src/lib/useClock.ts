import { useEffect, useState } from "react";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function format(date: Date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const weekday = WEEKDAYS[date.getDay()];
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];

  return `${hh}:${mm} · ${weekday}, ${day} ${month}`;
}

export function useClock() {
  const [now, setNow] = useState(() => format(new Date()));

  useEffect(() => {
    const id = setInterval(() => setNow(format(new Date())), 30_000);
    return () => clearInterval(id);
  }, []);

  return now;
}

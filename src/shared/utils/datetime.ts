const pad = (value: number) => value.toString().padStart(2, '0');

export const toLocalInputValue = (utcIso: string) => {
  const date = new Date(utcIso);
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

export const localInputToUtcIso = (localInput: string) => new Date(localInput).toISOString();

export const formatUtcToLocal = (utcIso: string) => {
  const date = new Date(utcIso);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
};

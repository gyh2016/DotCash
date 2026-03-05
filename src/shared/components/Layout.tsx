import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const tabs = [
  { path: '/home', label: '首页' },
  { path: '/records', label: '交易' },
  { path: '/accounts', label: '账户' },
  { path: '/stats', label: '统计' },
];

export const Layout = ({ children }: PropsWithChildren) => {
  const location = useLocation();
  const [now, setNow] = useState(() => new Date());
  const timezoneId = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const timezoneText = useMemo(() => {
    const tzName = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezoneId,
      timeZoneName: 'long',
    })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')?.value;
    return tzName ? `${tzName}（${timezoneId}）` : timezoneId;
  }, [now, timezoneId]);
  const timeText = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(now),
    [now],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const isWideRoute = (
    location.pathname.startsWith('/records')
    || location.pathname.startsWith('/accounts')
    || location.pathname.startsWith('/home')
    || location.pathname.startsWith('/stats')
  );

  return (
    <div className="layout">
      <aside className="desktop-nav">
        <h1>点金记账</h1>
        <NavLink
          to="/create"
          className={({ isActive }) => (isActive ? 'desktop-create-btn active' : 'desktop-create-btn')}
        >
          + 新增交易
        </NavLink>
        <nav>
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) => (isActive ? 'nav-btn active' : 'nav-btn')}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-datetime">
          <p>当前时区：</p>
          <p className="sidebar-datetime-value">{timezoneText}</p>
          <p>本地时间：{timeText}</p>
        </div>
      </aside>
      <main className={isWideRoute ? 'content content-wide' : 'content'}>{children}</main>
      <nav className="mobile-nav">
        <NavLink
          to="/home"
          className={({ isActive }) => (isActive ? 'mobile-btn active' : 'mobile-btn')}
        >
          首页
        </NavLink>
        <NavLink
          to="/records"
          className={({ isActive }) => (isActive ? 'mobile-btn active' : 'mobile-btn')}
        >
          交易
        </NavLink>
        <NavLink
          to="/create"
          className={({ isActive }) => (isActive ? 'mobile-create-btn active' : 'mobile-create-btn')}
        >
          新增交易
        </NavLink>
        <NavLink
          to="/accounts"
          className={({ isActive }) => (isActive ? 'mobile-btn active' : 'mobile-btn')}
        >
          账户
        </NavLink>
        <NavLink
          to="/stats"
          className={({ isActive }) => (isActive ? 'mobile-btn active' : 'mobile-btn')}
        >
          统计
        </NavLink>
      </nav>
    </div>
  );
};

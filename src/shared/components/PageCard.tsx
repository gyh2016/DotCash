import type { PropsWithChildren } from 'react';

interface PageCardProps extends PropsWithChildren {
  className?: string;
}

export const PageCard = ({ children, className }: PageCardProps) => {
  return <section className={className ? `card ${className}` : 'card'}>{children}</section>;
};

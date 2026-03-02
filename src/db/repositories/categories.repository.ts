import { db } from '@/db';

export const categoriesRepository = {
  async listByKind(kind: 'income' | 'expense') {
    const rows = await db.categories
      .where('kind')
      .equals(kind)
      .and((item) => item.deletedAt === null && !item.isArchived)
      .toArray();

    const uniqueByName = new Map<string, (typeof rows)[number]>();
    rows.forEach((item) => {
      if (!uniqueByName.has(item.name)) {
        uniqueByName.set(item.name, item);
      }
    });

    return Array.from(uniqueByName.values());
  },

  async listAllActive() {
    const rows = await db.categories
      .filter((item) => item.deletedAt === null && !item.isArchived)
      .toArray();

    const uniqueByKey = new Map<string, (typeof rows)[number]>();
    rows.forEach((item) => {
      const key = `${item.kind}:${item.name}`;
      if (!uniqueByKey.has(key)) uniqueByKey.set(key, item);
    });

    return Array.from(uniqueByKey.values());
  },
};

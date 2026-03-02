import { db } from '@/db';
import { defaultCategories } from '@/shared/constants/defaultCategories';
import { newId } from '@/shared/utils/id';

export const seedDefaults = async () => {
  const categoryCount = await db.categories.count();
  if (categoryCount > 0) return;

  await db.categories.bulkAdd(
    defaultCategories.map((category) => ({
      ...category,
      id: newId(),
    })),
  );
};

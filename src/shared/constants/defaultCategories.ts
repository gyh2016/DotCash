import type { Category } from '@/domain/types';

const now = new Date().toISOString();

export const defaultCategories: Omit<Category, 'id'>[] = [
  { name: '工资', kind: 'income', isSystem: true, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null },
  { name: '奖金', kind: 'income', isSystem: true, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null },
  { name: '其他收入', kind: 'income', isSystem: true, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null },
  { name: '餐饮', kind: 'expense', isSystem: true, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null },
  { name: '交通', kind: 'expense', isSystem: true, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null },
  { name: '购物', kind: 'expense', isSystem: true, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null },
  { name: '住房', kind: 'expense', isSystem: true, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null },
  { name: '娱乐', kind: 'expense', isSystem: true, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null },
  { name: '医疗', kind: 'expense', isSystem: true, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null },
  { name: '教育', kind: 'expense', isSystem: true, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null },
  { name: '其他支出', kind: 'expense', isSystem: true, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null },
];

import { customAlphabet } from 'nanoid';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const newGenericId = customAlphabet(ALPHABET, 12);
const newAccountShortId = customAlphabet(ALPHABET, 10);
const newTransactionShortId = customAlphabet(ALPHABET, 14);

export const newId = () => newGenericId();
export const newAccountId = () => newAccountShortId();
export const newTransactionId = () => newTransactionShortId();

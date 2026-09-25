import argon2 from 'argon2';

export const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$9xrTO/fJjQKdlhYOzNfEZQ$pWVoi0CajoPrYMKGDTkogHJsLj9J1kjJelWVnIUBKww';

export async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
    hashLength: 32,
    saltLength: 16,
  });
}

export async function verifyPassword(encoded, password) {
  try {
    return await argon2.verify(encoded, password);
  } catch {
    return false;
  }
}

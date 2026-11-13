// Owner form state and validation for the first-owner step.
//
// The wizard creates one human account through the server bootstrap, so the
// form only refuses what the server would refuse anyway: a missing field, a
// password below the identity minimum (the backend default is 12 characters)
// or a confirmation that does not match. The two secrets are cleared together
// after every submit; the identity draft stays so a rejected username does not
// have to be retyped.

import type { OwnerInput } from './client';

/** Mirrors ``auth_password_min_length``'s default; the server stays authoritative. */
export const OWNER_PASSWORD_MIN_LENGTH = 12;
/** Mirrors ``auth_password_max_length``'s default. */
export const OWNER_PASSWORD_MAX_LENGTH = 128;

export type OwnerFormCode = 'required' | 'too_short' | 'too_long' | 'mismatch';

export interface OwnerFormState {
  username: string;
  displayName: string;
  email: string;
  password: string;
  confirm: string;
}

export function emptyOwnerForm(): OwnerFormState {
  return { username: '', displayName: '', email: '', password: '', confirm: '' };
}

export function validateOwnerForm(state: OwnerFormState): OwnerFormCode | null {
  if (!state.username.trim() || !state.displayName.trim() || !state.password) return 'required';
  if (state.password.length < OWNER_PASSWORD_MIN_LENGTH) return 'too_short';
  if (state.password.length > OWNER_PASSWORD_MAX_LENGTH) return 'too_long';
  if (state.password !== state.confirm) return 'mismatch';
  return null;
}

/** Drops both secrets and keeps the draft the operator already typed. */
export function clearOwnerSecrets(state: OwnerFormState): OwnerFormState {
  return { ...state, password: '', confirm: '' };
}

export function ownerInput(state: OwnerFormState): OwnerInput {
  return {
    username: state.username.trim(),
    displayName: state.displayName.trim(),
    email: state.email.trim(),
    password: state.password,
  };
}

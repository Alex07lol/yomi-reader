/* ─── Profile service ───
   Public username + optional avatar. Avatars live in the `avatars` Supabase
   Storage bucket under `<auth.uid()>/…`; profiles only store the object path. */

import { getCommunityClient, getCommunityPublicUrl, requireCommunityClient } from './supabase';
import { normalizeUsername, validateUsername } from './auth';
import type { CommunityProfile, ProfileActivitySummary } from './types';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface ProfileRow {
  id: string;
  username: string;
  avatar_path: string | null;
  created_at: string;
}

function mapProfile(row: ProfileRow): CommunityProfile {
  return {
    id: row.id,
    username: row.username,
    avatarPath: row.avatar_path,
    createdAt: row.created_at,
  };
}

export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = getCommunityPublicUrl();
  if (!base) return null;
  return `${base}/storage/v1/object/public/avatars/${path}`;
}

export async function getProfile(userId: string): Promise<CommunityProfile | null> {
  const client = await getCommunityClient();
  if (!client) return null;
  const { data, error } = await client
    .from('profiles')
    .select('id,username,avatar_path,created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return mapProfile(data as ProfileRow);
}

export async function getMyProfile(): Promise<CommunityProfile | null> {
  const client = await requireCommunityClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return null;
  return getProfile(userData.user.id);
}

export async function updateUsername(username: string): Promise<CommunityProfile> {
  const validationError = validateUsername(username);
  if (validationError) throw new Error(validationError);

  const client = await requireCommunityClient();
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) throw new Error('Sign in to update your profile.');

  const { data, error } = await client
    .from('profiles')
    .update({ username: normalizeUsername(username) })
    .eq('id', userData.user.id)
    .select('id,username,avatar_path,created_at')
    .single();
  if (error) {
    if (error.code === '23505' || /duplicate key/.test(error.message)) {
      throw new Error('That username is already taken.');
    }
    throw new Error(error.message || 'Your profile could not be saved.');
  }
  return mapProfile(data as ProfileRow);
}

function avatarExtension(file: File): string {
  switch (file.type) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    default: return 'jpg';
  }
}

/** Validates and uploads an avatar for the signed-in user. Returns the storage path. */
export async function uploadAvatar(file: File): Promise<string> {
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    throw new Error('Choose a PNG, JPEG or WebP image.');
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('Avatars must be 2 MB or smaller.');
  }

  const client = await requireCommunityClient();
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) throw new Error('Sign in to update your avatar.');
  const userId = userData.user.id;

  const random = crypto.randomUUID().slice(0, 8);
  const path = `${userId}/${random}.${avatarExtension(file)}`;

  const { error: uploadError } = await client.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw new Error(uploadError.message || 'The avatar could not be uploaded.');

  const { data: previous } = await client
    .from('profiles')
    .select('avatar_path')
    .eq('id', userId)
    .maybeSingle();

  const { error: profileError } = await client
    .from('profiles')
    .update({ avatar_path: path })
    .eq('id', userId);
  if (profileError) throw new Error(profileError.message || 'The avatar could not be saved.');

  const previousPath = (previous as { avatar_path?: string | null } | null)?.avatar_path;
  if (previousPath && previousPath !== path) {
    await client.storage.from('avatars').remove([previousPath]);
  }

  return path;
}

export async function removeAvatar(): Promise<void> {
  const client = await requireCommunityClient();
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) throw new Error('Sign in to update your avatar.');

  const { data } = await client
    .from('profiles')
    .select('avatar_path')
    .eq('id', userData.user.id)
    .maybeSingle();
  const path = (data as { avatar_path?: string | null } | null)?.avatar_path ?? null;

  const { error } = await client
    .from('profiles')
    .update({ avatar_path: null })
    .eq('id', userData.user.id);
  if (error) throw new Error(error.message || 'The avatar could not be removed.');

  if (path) await client.storage.from('avatars').remove([path]);
}

/** Case-insensitive public lookup by the unique username. */
export async function getProfileByUsername(username: string): Promise<CommunityProfile | null> {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const client = await getCommunityClient();
  if (!client) return null;
  const { data, error } = await client
    .from('profiles')
    .select('id,username,avatar_path,created_at')
    .eq('username', normalized)
    .maybeSingle();
  if (error || !data) return null;
  return mapProfile(data as ProfileRow);
}

/** Visible activity counts and upvotes received. Returns zeros on failure. */
export async function getProfileStats(userId: string): Promise<ProfileActivitySummary> {
  const empty: ProfileActivitySummary = {
    userId,
    chapterCommentCount: 0,
    novelCommentCount: 0,
    reviewCount: 0,
    likesReceived: 0,
  };
  const client = await getCommunityClient();
  if (!client) return empty;
  try {
    const { data, error } = await client
      .from('profile_activity_summary')
      .select('chapter_comment_count,novel_comment_count,review_count,likes_received')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return empty;
    const row = data as {
      chapter_comment_count: number | string | null;
      novel_comment_count: number | string | null;
      review_count: number | string | null;
      likes_received: number | string | null;
    };
    return {
      userId,
      chapterCommentCount: Number(row.chapter_comment_count) || 0,
      novelCommentCount: Number(row.novel_comment_count) || 0,
      reviewCount: Number(row.review_count) || 0,
      likesReceived: Number(row.likes_received) || 0,
    };
  } catch {
    return empty;
  }
}

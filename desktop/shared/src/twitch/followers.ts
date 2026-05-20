import { createTwitchHeaders, type TwitchAuthOptions } from "./auth";

export type TwitchChannelFollower = {
  user_id: string;
  user_login: string;
  user_name: string;
  followed_at: string;
};

export const getChannelFollower = async (
  auth: TwitchAuthOptions,
  input: {
    broadcasterId: string;
    userId: string;
    apiBaseUrl?: string;
  },
): Promise<TwitchChannelFollower | undefined> => {
  const apiBaseUrl = (input.apiBaseUrl ?? "https://api.twitch.tv").replace(
    /\/+$/,
    "",
  );
  const params = new URLSearchParams({
    broadcaster_id: input.broadcasterId,
    user_id: input.userId,
  });
  const response = await fetch(
    `${apiBaseUrl}/helix/channels/followers?${params}`,
    {
      headers: createTwitchHeaders(auth),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Twitch follower ${input.userId}: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    data?: TwitchChannelFollower[];
  };
  return body.data?.[0];
};

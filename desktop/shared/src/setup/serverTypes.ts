export type SetupServerHandle = {
  url: string;
  stop: () => Promise<void>;
};

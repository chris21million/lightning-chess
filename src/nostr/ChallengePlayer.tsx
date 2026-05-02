import React from "react";

type ChallengePlayerProps = {
  challengeNpub: string;
  setChallengeNpub: (value: string) => void;
  isChallenging: boolean;
  challengePlayer: () => Promise<void>;
  offerMinutes: number;
  offerInc: number;
  offerColor: "random" | "white" | "black";
};

export default function ChallengePlayer({
  challengeNpub,
  setChallengeNpub,
  isChallenging,
  challengePlayer,
  offerMinutes,
  offerInc,
  offerColor,
}: ChallengePlayerProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    challengePlayer();
  };

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 mb-8">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* NPUB Input */}
        <div>
          <label className="block text-sm text-zinc-400 mb-1">
            
          </label>
          <input
            type="text"
            value={challengeNpub}
            onChange={(e) => setChallengeNpub(e.target.value)}
            placeholder="npub1... or hex"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 font-mono text-sm"
            disabled={isChallenging}
          />
        </div>

        {/* Current Settings Summary */}
        <div className="bg-zinc-800 rounded-lg p-3 text-sm text-zinc-300">
         
        </div>

        {/* Button */}
        <button
          type="submit"
          disabled={isChallenging || !challengeNpub.trim()}
          className={`w-full py-3.5 rounded-lg font-medium text-base transition-all ${
            isChallenging || !challengeNpub.trim()
              ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-500 text-white"
          }`}
        >
          {isChallenging ? "Sending challenge..." : "Send Challenge"}
        </button>

        <p className="text-xs text-zinc-500 text-center">
          

        </p>
      </form>
    </div>
  );
}
import React from "react";

type Person = "sender" | "recipient" | "friend" | "family";

const people: Record<Person, { background: string; shirt: string; skin: string; hair: string }> = {
  sender: { background: "#D9F7E9", shirt: "#164A36", skin: "#B87354", hair: "#272126" },
  recipient: { background: "#F7EAD9", shirt: "#247282", skin: "#DDA078", hair: "#372524" },
  friend: { background: "#E5EAF5", shirt: "#506789", skin: "#E5B78F", hair: "#302625" },
  family: { background: "#F0E7D9", shirt: "#B56656", skin: "#8D553E", hair: "#1B2526" },
};

function Portrait({ person }: { person: Person }) {
  const colors = people[person];
  const clipId = `reach-handoff-${person}`;
  return <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <defs><clipPath id={clipId}><circle cx="50" cy="50" r="48" /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>
      <circle cx="50" cy="50" r="50" fill={colors.background} />
      <path d="M8 103c3-26 18-40 42-40s39 14 42 40" fill={colors.shirt} />
      <path d="M42 58h16v18c-4 5-12 5-16 0z" fill={colors.skin} />
      {person === "recipient" ? <>
        <circle cx="29" cy="31" r="15" fill={colors.hair} /><circle cx="42" cy="22" r="17" fill={colors.hair} /><circle cx="59" cy="23" r="17" fill={colors.hair} /><circle cx="73" cy="34" r="14" fill={colors.hair} />
      </> : person === "family" ? <path d="M25 44c-1-27 13-34 26-34 17 0 29 10 27 35l-8 11-3-20-32-2-3 22z" fill={colors.hair} /> : person === "friend" ? <path d="M25 38c3-24 20-31 35-25 14 5 20 20 16 32l-10-12-19-5-18 17z" fill={colors.hair} /> : <path d="M23 45c-1-24 13-37 30-36 17 0 28 11 27 33l-10-8-7-12c-7 11-21 17-34 18l-2 14z" fill={colors.hair} />}
      <ellipse cx="50" cy="47" rx="22" ry="25" fill={colors.skin} />
      {person === "sender" && <path d="M27 39c6-2 25-6 35-19 2 9 7 13 12 16-2-18-12-27-24-27-17 0-27 12-27 31z" fill={colors.hair} />}
      {person === "friend" && <path d="M27 40c5-10 16-16 27-16 8 0 15 3 21 10-5-18-16-24-28-23-13 1-21 12-20 29z" fill={colors.hair} />}
      {person === "family" && <path d="M28 35c2-16 12-25 26-25 14 0 24 10 25 26-10-3-15-11-19-17-7 10-18 15-32 16z" fill={colors.hair} />}
      {person === "recipient" && <path d="M27 37c1-14 10-25 24-25 17 0 25 11 25 27-7-4-12-11-15-17-8 10-20 14-34 15z" fill={colors.hair} />}
      <path d="M38 47h5m14 0h5" stroke="#302522" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M45 58c3 3 7 3 10 0" stroke="#7B3F37" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <circle cx="30" cy="50" r="4" fill={colors.skin} /><circle cx="70" cy="50" r="4" fill={colors.skin} />
    </g>
  </svg>;
}

export default function HeroHandoffScene() {
  return <div className="ux15-hero-scene ux15-hero-enter" role="img" aria-label="Concept illustration: a sender shares a payment link with a recipient, with two more people nearby">
    <div className="ux15-scene-halo" aria-hidden="true" />
    <svg className="ux15-scene-paths" viewBox="0 0 440 400" aria-hidden="true" focusable="false">
      <path className="ux15-scene-main-path" d="M132 177 C 190 130, 245 128, 306 165" />
      <path className="ux15-scene-branch-path" d="M132 184 C 185 258, 275 282, 361 302" />
      <path className="ux15-scene-branch-path ux15-scene-branch-two" d="M132 184 C 164 253, 198 299, 239 322" />
    </svg>
    <div className="ux15-scene-person ux15-scene-sender"><span className="ux15-scene-portrait"><Portrait person="sender" /></span><span className="ux15-scene-label">Sender</span></div>
    <div className="ux15-scene-person ux15-scene-recipient"><span className="ux15-scene-portrait"><Portrait person="recipient" /></span><span className="ux15-scene-label">Recipient</span></div>
    <span className="ux15-scene-token" aria-hidden="true">$</span>
    <span className="ux15-scene-ripple" aria-hidden="true" />
    <span className="ux15-scene-link-label" aria-hidden="true">PRIVATE LINK</span>
    <div className="ux15-scene-more" aria-hidden="true"><span className="ux15-scene-mini ux15-scene-mini-one"><Portrait person="friend" /></span><span className="ux15-scene-mini ux15-scene-mini-two"><Portrait person="family" /></span><span>One to many, too</span></div>
  </div>;
}

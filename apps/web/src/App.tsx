import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import { Home } from "./Home";
import { RoomView } from "./RoomView";
import { tryReconnect } from "./net";

export function App() {
  const [room, setRoom] = useState<Room | null>(null);
  const [booting, setBooting] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    tryReconnect().then((r) => {
      if (r) setRoom(r);
      setBooting(false);
    });
  }, []);

  if (booting) return <main className="center"><p>Carregando…</p></main>;
  if (!room) return <Home onEnter={setRoom} notice={notice} />;
  return (
    <RoomView
      room={room}
      onLeave={(msg) => {
        setNotice(msg ?? "");
        setRoom(null);
      }}
    />
  );
}

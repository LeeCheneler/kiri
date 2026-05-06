import { useEffect, useState } from "react";

export function App() {
  const [todos, setTodos] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/todos")
      .then((res) => res.json())
      .then(setTodos);
  }, []);

  return (
    <>
      <h1>Kiri</h1>
      <ul>
        {todos.map((todo) => (
          <li key={todo}>{todo}</li>
        ))}
      </ul>
    </>
  );
}

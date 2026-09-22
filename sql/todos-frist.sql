-- v4.87.0: Frist für Aufgaben (ToDos). Fügt nur eine leere Spalte hinzu,
-- bestehende Aufgaben bleiben unverändert (Frist = leer).
alter table public.todos add column if not exists due_date date;

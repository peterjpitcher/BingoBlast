# Anchor Bingo Web App

A 90-ball bingo management system for The Anchor, featuring Admin, Host, and Display interfaces.

## Documentation

The full Product Requirements Document (PRD) is available in [docs/PRD.md](docs/PRD.md).

## Getting Started

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Environment Setup:**
    Copy `.env.local.example` to `.env.local` and add your Supabase credentials.
    ```bash
    cp .env.local.example .env.local
    ```

3.  **Run the development server:**
    ```bash
    npm run dev
    ```

4.  **Open the app:**
    Visit [http://localhost:3000](http://localhost:3000) to see the landing page with links to the 3 main interfaces:
    -   **Admin:** `/admin`
    -   **Host:** `/host`
    -   **Display:** `/display`

## Tech Stack

-   **Frontend:** Next.js (App Router), React, Bootstrap, React-Bootstrap
-   **Backend / DB:** Supabase (Auth, Database, Realtime)
-   **Language:** TypeScript

## Project Structure

-   `src/app/admin`: Admin interface pages.
-   `src/app/host`: Host controller interface pages.
-   `src/app/display`: Guest TV display interface pages.
-   `src/lib`: Shared utilities (Supabase client, helpers).
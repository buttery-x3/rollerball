# Rollerball

## Development

Install dependencies, then start the browser application:

```text
npm install
npm run dev
```

Run the checks and production build with:

```text
npm run check
npm run test
npm run build
```

Use `npm run preview` to serve the production build locally.

The production site includes the diagnostics workbench so hosted scenarios, tuning,
and structured diagnostic layers remain inspectable outside the Vite development server.

## Play a local match

Open the local URL printed by `npm run dev`. The default scenario is a five-minute
human-versus-AI match: gold attacks upward, pink attacks downward, and the white
ring identifies your controlled player. Each team has four skaters and one keeper.
Choose **Start match**, or press Enter / controller Menu. The clock pauses after
goals. **Rematch** returns to Ready with a fresh score and clock, without refreshing.

| Action | Keyboard | Standard controller |
| --- | --- | --- |
| Move and face | WASD / arrow keys | Left stick |
| Low throw, or check while defending | J | A / bottom face button |
| Lob | K | B / right face button |
| Switch field player | L | X / left face button |
| Immediate directional low throw | — | Right stick |
| Start / rematch | Enter | Menu / Start |

Hold and release a throw button to charge. Prepare the same buttons before an
incoming pass for a one-touch redirect. Control follows possession and strong
receiver claims; keeper possession also transfers control for distribution.
Click the arena before using keyboard controls after editing workbench fields.

Use the workbench to pause, inspect a named scenario, step simulation ticks and
adjust central tuning. Loaded scripted scenarios drive their authored inputs;
return to **Match · ready for human vs AI 5v5** for interactive play.

## Production hosting

See [Deployment](docs/deployment.md) for buttery.wtf hosting, PM2 and manual deployments.

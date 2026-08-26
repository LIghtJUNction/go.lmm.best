import { useEffect, useMemo, useRef, useState } from 'react'
import type { Copy, Language } from './lib/i18n'
import { copy } from './lib/i18n'
import { applyMove, createBoard, serializeBoard, type Board, type Point, type Stone } from './lib/go'
import { registerWebMCPTools, type WebMCPCallbacks, type WebMCPStatus } from './lib/webmcp'
import './styles.css'

type RoomView = 'idle' | 'searching' | 'playing' | 'finished'
type MatchMode = 'real' | 'demo'
type EndReason = 'human-resigned' | 'ai-resigned' | 'double-pass'
type Actor = 'human' | 'ai'
type ErrorKey = 'toolAlreadyMatched' | 'toolNeedsQueue' | 'toolNeedsGame' | 'toolWrongTurn' | 'toolStaleState' | 'toolInvalidMove' | 'wrongTurn' | 'illegalOccupied' | 'illegalSuicide' | 'illegalRepetition'

type Move = {
  number: number
  point?: Point
  stone: Stone
  captured: number
  actor: Actor
  pass?: boolean
}

type GameState = {
  board: Board
  turn: Stone
  humanColor: Stone
  aiColor: Stone
  captures: Record<Stone, number>
  moves: Move[]
  positionHistory: string[]
  passCount: number
  endReason?: EndReason
}

const BOARD_SIZE = 9
const HUMAN_COLOR: Stone = 'black'
const AI_COLOR: Stone = 'white'

function createGame(): GameState {
  const board = createBoard(BOARD_SIZE)
  return {
    board,
    turn: HUMAN_COLOR,
    humanColor: HUMAN_COLOR,
    aiColor: AI_COLOR,
    captures: { black: 0, white: 0 },
    moves: [],
    positionHistory: [serializeBoard(board)],
    passCount: 0,
  }
}

function createPreviewBoard(): Board {
  const board = createBoard(BOARD_SIZE)
  const stones: Array<[number, number, Stone]> = [
    [2, 2, 'black'],
    [6, 2, 'white'],
    [4, 4, 'black'],
    [3, 5, 'white'],
    [5, 5, 'black'],
    [2, 6, 'white'],
    [6, 6, 'black'],
  ]
  for (const [x, y, stone] of stones) board[y][x] = stone
  return board
}

const previewBoard = createPreviewBoard()

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remaining = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remaining}`
}

function App() {
  const [language, setLanguage] = useState<Language>('en')
  const [view, setView] = useState<RoomView>('idle')
  const [matchMode, setMatchMode] = useState<MatchMode>('real')
  const [game, setGame] = useState<GameState>(createGame)
  const [webmcpStatus, setWebmcpStatus] = useState<WebMCPStatus>('unsupported')
  const [queueStartedAt, setQueueStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [errorKey, setErrorMessage] = useState<ErrorKey | null>(null)
  const [lastToolCall, setLastToolCall] = useState<string | null>(null)
  const t = useMemo(() => copy[language], [language])
  const errorMessage = errorKey ? t[errorKey] : null
  const callbacksRef = useRef<WebMCPCallbacks>({
    joinMatch: () => ({ ok: false }),
    getGameState: () => ({ ok: false }),
    playMove: () => ({ ok: false }),
    passTurn: () => ({ ok: false }),
    resignGame: () => ({ ok: false }),
  })

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])

  useEffect(() => {
    if (view !== 'searching' || queueStartedAt === null) {
      setElapsed(0)
      return
    }

    const updateElapsed = () => setElapsed(Math.floor((Date.now() - queueStartedAt) / 1000))
    updateElapsed()
    const timer = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(timer)
  }, [queueStartedAt, view])

  const startMatch = () => {
    setMatchMode('real')
    setView('searching')
    setQueueStartedAt(Date.now())
    setGame(createGame())
    setErrorMessage(null)
    setLastToolCall(null)
  }

  const startDemo = () => {
    setMatchMode('demo')
    setView('playing')
    setQueueStartedAt(null)
    setGame(createGame())
    setErrorMessage(null)
    setLastToolCall(null)
  }

  const returnToLobby = () => {
    setView('idle')
    setQueueStartedAt(null)
    setGame(createGame())
    setErrorMessage(null)
    setLastToolCall(null)
  }

  const getGameState = () => ({
    ok: true,
    room: view,
    mode: matchMode,
    boardSize: BOARD_SIZE,
    board: game.board.map((row) => row.map((cell) => cell ?? 'empty')),
    turn: game.turn,
    humanColor: game.humanColor,
    aiColor: game.aiColor,
    captures: game.captures,
    moves: game.moves,
    revision: game.moves.length,
    positionHash: game.positionHistory.at(-1),
    lastMove: game.moves.at(-1) ?? null,
  })

  const joinMatch = (input: { displayName?: string }) => {
    if (view !== 'searching') {
      const reason: ErrorKey = view === 'playing' || view === 'finished' ? 'toolAlreadyMatched' : 'toolNeedsQueue'
      setErrorMessage(reason)
      return { ok: false, error: t[reason] }
    }

    setView('playing')
    setQueueStartedAt(null)
    setGame(createGame())
    setErrorMessage(null)
    setLastToolCall('join_go_match')
    return {
      ok: true,
      matched: true,
      human: { displayName: t.human, color: HUMAN_COLOR },
      ai: { displayName: input.displayName || t.ai, color: AI_COLOR },
      message: t.statusReady,
    }
  }

  const playAiMove = (point: Point, expectedRevision: number) => {
    if (view !== 'playing') {
      const message = t.toolNeedsGame
      setErrorMessage('toolNeedsGame')
      return { ok: false, error: message }
    }
    if (expectedRevision !== game.moves.length) {
      const message = t.toolStaleState
      setErrorMessage('toolStaleState')
      return { ok: false, error: message, currentRevision: game.moves.length }
    }
    if (game.turn !== game.aiColor) {
      const message = t.toolWrongTurn
      setErrorMessage('toolWrongTurn')
      return { ok: false, error: message }
    }

    const result = applyMove(game.board, point, game.aiColor, new Set(game.positionHistory))
    if (!result.ok) {
      const message = t.toolInvalidMove
      setErrorMessage('toolInvalidMove')
      return { ok: false, error: message, reason: result.error }
    }

    const move: Move = {
      number: game.moves.length + 1,
      point,
      stone: game.aiColor,
      captured: result.captured,
      actor: 'ai',
    }
    setGame((current) => ({
      ...current,
      board: result.board,
      turn: current.humanColor,
      captures: { ...current.captures, [current.aiColor]: current.captures[current.aiColor] + result.captured },
      moves: [...current.moves, move],
      positionHistory: [...current.positionHistory, serializeBoard(result.board)],
      passCount: 0,
    }))
    setErrorMessage(null)
    setLastToolCall('play_go_move')
    return { ok: true, move, revision: move.number, nextTurn: game.humanColor }
  }

  const passFor = (actor: Actor, expectedRevision?: number) => {
    if (view !== 'playing') {
      const message = t.toolNeedsGame
      setErrorMessage('toolNeedsGame')
      return { ok: false, error: message }
    }
    if (actor === 'ai' && expectedRevision !== game.moves.length) {
      const message = t.toolStaleState
      setErrorMessage('toolStaleState')
      return { ok: false, error: message, currentRevision: game.moves.length }
    }
    const expectedStone = actor === 'human' ? game.humanColor : game.aiColor
    if (game.turn !== expectedStone) {
      const reason: ErrorKey = actor === 'human' ? 'wrongTurn' : 'toolWrongTurn'
      setErrorMessage(reason)
      return { ok: false, error: t[reason] }
    }

    const move: Move = {
      number: game.moves.length + 1,
      stone: expectedStone,
      captured: 0,
      actor,
      pass: true,
    }
    const isFinished = game.passCount + 1 >= 2
    setGame((current) => ({
      ...current,
      turn: current.turn === 'black' ? 'white' : 'black',
      moves: [...current.moves, move],
      passCount: current.passCount + 1,
      endReason: isFinished ? 'double-pass' : undefined,
    }))
    if (isFinished) setView('finished')
    setErrorMessage(null)
    setLastToolCall(actor === 'ai' ? 'pass_go_turn' : null)
    return { ok: true, finished: isFinished, revision: move.number, nextTurn: expectedStone === 'black' ? 'white' : 'black' }
  }

  const resignFor = (actor: Actor, expectedRevision?: number) => {
    if (view !== 'playing') {
      const message = t.toolNeedsGame
      setErrorMessage('toolNeedsGame')
      return { ok: false, error: message }
    }
    if (actor === 'ai' && expectedRevision !== game.moves.length) {
      const message = t.toolStaleState
      setErrorMessage('toolStaleState')
      return { ok: false, error: message, currentRevision: game.moves.length }
    }
    const expectedStone = actor === 'human' ? game.humanColor : game.aiColor
    if (game.turn !== expectedStone && actor === 'ai') {
      const message = t.toolWrongTurn
      setErrorMessage('toolWrongTurn')
      return { ok: false, error: message }
    }

    const endReason: EndReason = actor === 'human' ? 'human-resigned' : 'ai-resigned'
    setGame((current) => ({ ...current, endReason }))
    setView('finished')
    setErrorMessage(null)
    setLastToolCall(actor === 'ai' ? 'resign_go_game' : null)
    return { ok: true, finished: true, revision: game.moves.length, winner: actor === 'human' ? game.aiColor : game.humanColor }
  }

  const handleHumanMove = (point: Point) => {
    if (view !== 'playing') return
    if (game.turn !== game.humanColor) {
      setErrorMessage('wrongTurn')
      return
    }

    const result = applyMove(game.board, point, game.humanColor, new Set(game.positionHistory))
    if (!result.ok) {
      const reason: ErrorKey = result.error === 'occupied'
        ? 'illegalOccupied'
        : result.error === 'suicide'
          ? 'illegalSuicide'
          : 'illegalRepetition'
      setErrorMessage(reason)
      return
    }

    const move: Move = {
      number: game.moves.length + 1,
      point,
      stone: game.humanColor,
      captured: result.captured,
      actor: 'human',
    }
    setGame((current) => ({
      ...current,
      board: result.board,
      turn: current.aiColor,
      captures: { ...current.captures, [current.humanColor]: current.captures[current.humanColor] + result.captured },
      moves: [...current.moves, move],
      positionHistory: [...current.positionHistory, serializeBoard(result.board)],
      passCount: 0,
    }))
    setErrorMessage(null)
    setLastToolCall(null)
  }

  callbacksRef.current = {
    joinMatch,
    getGameState,
    playMove: playAiMove,
    passTurn: (expectedRevision) => passFor('ai', expectedRevision),
    resignGame: (expectedRevision) => resignFor('ai', expectedRevision),
  }

  useEffect(() => registerWebMCPTools({
    joinMatch: (input) => callbacksRef.current.joinMatch(input),
    getGameState: () => callbacksRef.current.getGameState(),
    playMove: (point, expectedRevision) => callbacksRef.current.playMove(point, expectedRevision),
    passTurn: (expectedRevision) => callbacksRef.current.passTurn(expectedRevision),
    resignGame: (expectedRevision) => callbacksRef.current.resignGame(expectedRevision),
  }, setWebmcpStatus), [])

  const toggleLanguage = () => setLanguage((current) => (current === 'zh' ? 'en' : 'zh'))
  const isGameView = view === 'playing' || view === 'finished'

  return (
    <div className="app-shell">
      <Header
        t={t}
        language={language}
        webmcpStatus={webmcpStatus}
        onLanguageToggle={toggleLanguage}
        onReturnHome={returnToLobby}
      />

      <main className="page-content">
        {view === 'idle' && (
          <Lobby
            t={t}
            webmcpStatus={webmcpStatus}
            onStartMatch={startMatch}
            onStartDemo={startDemo}
          />
        )}

        {view === 'searching' && (
          <Searching
            t={t}
            elapsed={elapsed}
            webmcpStatus={webmcpStatus}
            onCancel={returnToLobby}
            onStartDemo={startDemo}
          />
        )}

        {isGameView && (
          <GameRoom
            t={t}
            language={language}
            game={game}
            view={view}
            matchMode={matchMode}
            webmcpStatus={webmcpStatus}
            lastToolCall={lastToolCall}
            onMove={handleHumanMove}
            onPass={() => passFor('human')}
            onResign={() => resignFor('human')}
            onReturnLobby={returnToLobby}
            onNewGame={startMatch}
          />
        )}
      </main>

      {errorMessage && (
        <div className="error-toast" role="alert">
          <span className="error-toast__mark">!</span>
          <div>
            <strong>{t.errorLabel}</strong>
            <p>{errorMessage}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t.closeError} onClick={() => setErrorMessage(null)}><Icon name="close" /></button>
        </div>
      )}

      <footer className="site-footer">
        <span>{t.footerNote}</span>
        <span className="footer-domain">go.lmm.best <i aria-hidden="true">·</i> WebMCP</span>
      </footer>
    </div>
  )
}

type HeaderProps = {
  t: Copy
  language: Language
  webmcpStatus: WebMCPStatus
  onLanguageToggle: () => void
  onReturnHome: () => void
}

function Header({ t, language, webmcpStatus, onLanguageToggle, onReturnHome }: HeaderProps) {
  const statusTone = webmcpStatus === 'available' ? 'is-live' : 'is-muted'
  return (
    <header className="topbar">
      <button className="brand" type="button" onClick={onReturnHome} aria-label="go.lmm.best home">
        <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
        <span className="brand-wordmark">go<span>.</span>lmm<span>.</span>best</span>
      </button>
      <div className="topbar__right">
        <nav className="topnav" aria-label="Primary">
          <a href="#how-it-works">{t.navHow}</a>
          <a href="#tools">{t.navTools}</a>
        </nav>
        <span className={`connection-pill ${statusTone}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{t.webmcp}</span>
          <b>{webmcpStatus === 'available' ? t.connected : t.offline}</b>
        </span>
        <button className="language-switch" type="button" onClick={onLanguageToggle} aria-label={t.languageSwitchLabel}>
          <span className="language-switch__icon" aria-hidden="true">{language === 'zh' ? '中' : 'A'}</span>
          <span>{language === 'zh' ? 'EN' : '中'}</span>
        </button>
      </div>
    </header>
  )
}

type LobbyProps = {
  t: Copy
  webmcpStatus: WebMCPStatus
  onStartMatch: () => void
  onStartDemo: () => void
}

function Lobby({ t, webmcpStatus, onStartMatch, onStartDemo }: LobbyProps) {
  return (
    <section className="lobby-layout" aria-labelledby="lobby-title">
      <div className="hero-column">
        <h1 id="lobby-title">{t.heroTitle.split('\n').map((line, index) => <span key={line}>{line}{index === 0 && <br />}</span>)}</h1>
        <p className="hero-description">{t.heroDescription}</p>
        <div className="hero-actions">
          <button type="button" className="primary-button" onClick={onStartMatch}>
            <span>{t.startMatch}</span><span className="button-arrow"><Icon name="arrow-up-right" /></span>
          </button>
          <button type="button" className="text-button" onClick={onStartDemo}>
            <span>{t.viewDemo}</span><Icon name="arrow-right" />
          </button>
        </div>
        <div className="hero-footnote">
          <span className={`mini-status ${webmcpStatus === 'available' ? 'is-live' : ''}`}><span className="status-dot" />{webmcpStatus === 'available' ? t.webmcpReady : t.demoHint}</span>
        </div>

        <div className="feature-row" aria-label={t.lobbyStatus}>
          <div className="feature-item"><span className="feature-icon"><Icon name="match" /></span><span><strong>{t.lobbyStatus}</strong><small>{t.lobbyStatusDetail}</small></span></div>
          <div className="feature-item"><span className="feature-icon"><Icon name="board" /></span><span><strong>{t.matchMode}</strong><small>{t.noAccount}</small></span></div>
          <div className="feature-item"><span className="feature-icon"><Icon name="tools" /></span><span><strong>{t.liveTools}</strong><small>{t.copyToolHint}</small></span></div>
        </div>

        <HowItWorks t={t} />
      </div>

      <div className="lobby-visual-column">
        <BoardPreview t={t} />
        <div className="signal-card">
          <div className="signal-card__top"><span className="signal-label">{t.statusLabel}</span><span className="signal-live"><span className="status-dot is-live" />{t.waiting}</span></div>
          <div className="signal-card__body"><span className="signal-number">01</span><span><strong>{t.readyToPlay}</strong><small>{t.lobbyStatusDetail}</small></span></div>
          <div className="signal-card__line"><span /><span /><span /><span /><span /></div>
        </div>
      </div>
    </section>
  )
}

function HowItWorks({ t }: { t: Copy }) {
  const steps = [
    { number: '01', title: t.stepOne, detail: t.stepOneDetail },
    { number: '02', title: t.stepTwo, detail: t.stepTwoDetail },
    { number: '03', title: t.stepThree, detail: t.stepThreeDetail },
  ]
  return (
    <section className="steps-section" id="how-it-works" aria-labelledby="steps-title">
      <div className="section-heading"><h2 id="steps-title">{t.matchStepsTitle}</h2></div>
      <div className="steps-list">
        {steps.map((step) => <div className="step-item" key={step.number}><span className="step-number">{step.number}</span><span><strong>{step.title}</strong><small>{step.detail}</small></span></div>)}
      </div>
    </section>
  )
}

function BoardPreview({ t }: { t: Copy }) {
  return (
    <div className="preview-wrap">
      <div className="preview-label"><span>{t.boardPreview}</span><span>{t.boardPreviewHint}</span></div>
      <div className="board-card board-card--preview">
        <div className="board-card__top"><span className="small-caps">GO / 009</span><span className="board-card__signal"><span className="status-dot is-live" />{t.live}</span></div>
        <Board board={previewBoard} interactive={false} lastMove={{ x: 4, y: 4 }} t={t} />
        <div className="board-card__bottom"><span><i className="stone-key stone-key--black" />{t.human}</span><span className="vs-label">VS</span><span><i className="stone-key stone-key--white" />{t.ai}</span></div>
      </div>
    </div>
  )
}

type SearchingProps = {
  t: Copy
  elapsed: number
  webmcpStatus: WebMCPStatus
  onCancel: () => void
  onStartDemo: () => void
}

function Searching({ t, elapsed, webmcpStatus, onCancel, onStartDemo }: SearchingProps) {
  return (
    <section className="searching-layout" aria-labelledby="searching-title" data-state="searching">
      <div className="searching-copy">
        <div className="searching-orbit" aria-hidden="true"><span /><span /><span /><div className="orbit-center">GO</div></div>
        <h1 id="searching-title">{t.waitingTitle}</h1>
        <p className="hero-description">{t.waitingDescription}</p>
        <div className="queue-meta">
          <div><span>{t.queuePosition}</span><strong>{t.queuePositionValue}</strong></div>
          <div><span>{t.elapsed}</span><strong>{formatElapsed(elapsed)}</strong></div>
        </div>
        <div className="searching-actions"><button type="button" className="secondary-button" onClick={onCancel}>{t.cancelMatch}<Icon name="close" /></button><button type="button" className="text-button" onClick={onStartDemo}>{t.viewDemo}<Icon name="arrow-right" /></button></div>
        <p className="cancel-hint">{t.cancelHint}</p>
      </div>
      <aside className="waiting-panel">
        <div className="waiting-panel__head"><span className="panel-kicker">{t.statusLabel}</span><span className="waiting-chip"><span className="status-dot is-pulsing" />{t.waiting}</span></div>
        <div className="waiting-panel__main"><div className="waiting-glyph"><span /><span /><span /></div><strong>{t.waitingFor}</strong><p>{t.statusWaiting}</p></div>
        <div className="tool-call-card"><span className="tool-call-card__label">{t.aiCallHint}</span><code>{t.toolJoin}</code><span className={`tool-state ${webmcpStatus === 'available' ? 'is-live' : 'is-muted'}`}><span className="status-dot" />{webmcpStatus === 'available' ? t.listening : t.webmcpUnsupported}</span></div>
        <div className="waiting-panel__foot"><span className="waiting-pulse" /><span>{webmcpStatus === 'available' ? t.webmcpStandby : t.demoHint}</span></div>
      </aside>
    </section>
  )
}

type GameRoomProps = {
  t: Copy
  language: Language
  game: GameState
  view: RoomView
  matchMode: MatchMode
  webmcpStatus: WebMCPStatus
  lastToolCall: string | null
  onMove: (point: Point) => void
  onPass: () => void
  onResign: () => void
  onReturnLobby: () => void
  onNewGame: () => void
}

function GameRoom({ t, language, game, view, matchMode, webmcpStatus, lastToolCall, onMove, onPass, onResign, onReturnLobby, onNewGame }: GameRoomProps) {
  const isFinished = view === 'finished'
  const isHumanTurn = !isFinished && game.turn === game.humanColor
  const finishedText = game.endReason === 'human-resigned'
    ? t.finishedByResignYou
    : game.endReason === 'ai-resigned'
      ? t.finishedByResignAi
      : t.finishedByPass
  const statusText = isFinished ? finishedText : isHumanTurn ? t.statusYourTurn : t.statusAiTurn
  const modeText = matchMode === 'demo' ? t.demoMatch : t.gameLive

  return (
    <section className="game-layout" aria-labelledby="game-title" data-state={isFinished ? 'finished' : 'playing'}>
      <div className="game-main-column">
        <div className="game-heading">
          <div><h1 id="game-title">{t.gameTitle}</h1><p className="game-subtitle">{t.gameSubtitle}</p></div>
          <span className={`live-badge ${isFinished ? 'is-finished' : ''}`}><span className="status-dot" />{isFinished ? t.finishedTitle : modeText}</span>
        </div>
        <div className="game-board-card">
          <div className="game-board-card__top"><span className="small-caps">ROOM / 01</span><span className="board-turn-label"><span className={`turn-stone turn-stone--${game.turn}`} />{isFinished ? t.finishedTitle : game.turn === game.humanColor ? t.turnYou : t.turnAi}</span></div>
          <Board board={game.board} interactive={isHumanTurn} lastMove={game.moves.at(-1)?.point} onMove={onMove} t={t} />
          <div className="game-board-card__bottom"><div className="board-tip"><span className="tip-mark">i</span><span>{isFinished ? t.statusFinished : isHumanTurn ? t.tipContent : t.statusAiTurn}</span></div><span className="board-size">9 × 9</span></div>
        </div>
        <div className={`turn-banner ${isFinished ? 'is-finished' : isHumanTurn ? 'is-human' : 'is-ai'}`}><span className="turn-banner__indicator" /><span>{statusText}</span>{!isFinished && <span className="turn-banner__right">{t.moves} {game.moves.length.toString().padStart(2, '0')}</span>}</div>
      </div>

      <aside className="game-sidebar">
        <PlayerStack t={t} game={game} isFinished={isFinished} />
        <div className="stat-strip"><div><span>{t.moves}</span><strong>{game.moves.length.toString().padStart(2, '0')}</strong></div><div><span>{t.captures}</span><strong>{game.captures[game.humanColor].toString().padStart(2, '0')}</strong></div><div><span>{t.lastMove}</span><strong>{formatLastMove(game.moves.at(-1)?.point)}</strong></div></div>
        <ToolPanel t={t} webmcpStatus={webmcpStatus} lastToolCall={lastToolCall} />
        <MoveLog t={t} language={language} moves={game.moves} />
        {isFinished ? <div className="finish-actions"><button type="button" className="primary-button primary-button--full" onClick={onNewGame}><span>{t.newMatch}</span><span className="button-arrow"><Icon name="arrow-up-right" /></span></button><button type="button" className="text-button text-button--center" onClick={onReturnLobby}>{t.returnLobby}<Icon name="arrow-right" /></button></div> : <div className="game-actions"><button type="button" className="secondary-button" onClick={onPass} disabled={!isHumanTurn}>{t.pass}<Icon name="pass" /></button><button type="button" className="danger-button" onClick={onResign}>{t.resign}<Icon name="resign" /></button></div>}
      </aside>
    </section>
  )
}

function PlayerStack({ t, game, isFinished }: { t: Copy; game: GameState; isFinished: boolean }) {
  return (
    <div className="players-panel">
      <div className="players-panel__head"><span className="panel-kicker">{t.gameLive}</span><span className="players-count">{isFinished ? t.finishedTitle : '01 / 01'}</span></div>
      <div className={`player-row ${!isFinished && game.turn === game.humanColor ? 'is-active' : ''}`}><span className="player-stone player-stone--black" /><span className="player-copy"><strong>{t.human}</strong><small>{t.humanFull}</small></span><span className="player-color">{t.black}</span></div>
      <div className="player-divider"><span>VS</span></div>
      <div className={`player-row ${!isFinished && game.turn === game.aiColor ? 'is-active' : ''}`}><span className="player-stone player-stone--white" /><span className="player-copy"><strong>{t.ai}</strong><small>{t.aiFull}</small></span><span className="player-color">{t.white}</span></div>
    </div>
  )
}

function ToolPanel({ t, webmcpStatus, lastToolCall }: { t: Copy; webmcpStatus: WebMCPStatus; lastToolCall: string | null }) {
  const tools = [
    { icon: 'state' as const, label: t.toolState, code: 'get_go_game_state' },
    { icon: 'move' as const, label: t.toolMove, code: 'play_go_move' },
    { icon: 'pass' as const, label: t.toolPass, code: 'pass_go_turn' },
    { icon: 'resign' as const, label: t.toolResign, code: 'resign_go_game' },
  ]
  return (
    <section className="tools-panel" id="tools" aria-labelledby="tools-title">
      <div className="tools-panel__head"><h2 id="tools-title">{t.toolsTitle}</h2><span className={`tool-connection ${webmcpStatus === 'available' ? 'is-live' : 'is-muted'}`}><span className="status-dot" />{webmcpStatus === 'available' ? t.connected : t.offline}</span></div>
      <p>{t.toolsDescription}</p>
      <div className="tool-list">{tools.map((tool) => <div className={`tool-row ${lastToolCall === tool.code ? 'is-called' : ''}`} key={tool.code}><span className="tool-row__icon"><Icon name={tool.icon} /></span><span><strong>{tool.label}</strong><code>{tool.code}</code></span>{lastToolCall === tool.code && <span className="tool-row__check"><Icon name="check" /></span>}</div>)}</div>
    </section>
  )
}

function MoveLog({ t, language, moves }: { t: Copy; language: Language; moves: Move[] }) {
  return (
    <section className="move-log" aria-labelledby="move-log-title">
      <div className="move-log__head"><h2 id="move-log-title">{t.moveLog}</h2><span>{moves.length.toString().padStart(2, '0')}</span></div>
      {moves.length === 0 ? <p className="empty-log">{t.emptyMoves}</p> : <ol>{moves.slice(-5).reverse().map((move) => <li key={`${move.number}-${move.actor}`}><span className={`log-stone log-stone--${move.stone}`} /> <span className="log-number">{move.number.toString().padStart(2, '0')}</span><span>{move.pass ? (language === 'zh' ? '停一手' : 'Pass') : formatLastMove(move.point)}</span><small>{move.actor === 'human' ? t.human : t.ai}</small></li>)}</ol>}
    </section>
  )
}

type BoardProps = {
  board: Board
  interactive: boolean
  lastMove?: Point
  onMove?: (point: Point) => void
  t: Copy
}

function Board({ board, interactive, lastMove, onMove, t }: BoardProps) {
  const size = board.length
  const coordinates = 'ABCDEFGHI'
  return (
    <div className={`board-surface ${interactive ? 'is-interactive' : 'is-static'}`}>
      <div className="board-coordinates board-coordinates--top" aria-hidden="true">{coordinates.slice(0, size).split('').map((letter) => <span key={letter}>{letter}</span>)}</div>
      <div className="board-coordinates board-coordinates--bottom" aria-hidden="true">{coordinates.slice(0, size).split('').map((letter) => <span key={letter}>{letter}</span>)}</div>
      <div className="board-coordinates board-coordinates--left" aria-hidden="true">{Array.from({ length: size }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
      <div className="board-coordinates board-coordinates--right" aria-hidden="true">{Array.from({ length: size }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
      <div className="go-board" role="grid" aria-label={t.ariaBoard}>
        <div className="board-lines" aria-hidden="true">{Array.from({ length: size }, (_, index) => <span className="board-line board-line--vertical" data-board-position={index} key={`v-${index}`} />)}{Array.from({ length: size }, (_, index) => <span className="board-line board-line--horizontal" data-board-position={index} key={`h-${index}`} />)}</div>
        <div className="star-points" aria-hidden="true">{[2, 4, 6].flatMap((y) => [2, 4, 6].map((x) => <span key={`${x}-${y}`} data-board-x={x} data-board-y={y} />))}</div>
        {board.map((row, y) => row.map((cell, x) => {
          const occupied = cell === 'black' ? t.occupiedBlack : cell === 'white' ? t.occupiedWhite : t.emptyIntersection
          const isLast = lastMove?.x === x && lastMove?.y === y
          return <button key={`${x}-${y}`} type="button" className={`intersection ${cell ? `has-${cell}` : ''} ${isLast ? 'is-last' : ''}`} data-board-x={x} data-board-y={y} onClick={() => onMove?.({ x, y })} disabled={!interactive || Boolean(cell)} aria-label={t.ariaIntersection(x, y, occupied)} role="gridcell">{cell && <span className="stone" aria-hidden="true">{isLast && <i />}</span>}</button>
        }))}
      </div>
    </div>
  )
}

type IconName = 'arrow-up-right' | 'arrow-right' | 'match' | 'board' | 'tools' | 'close' | 'pass' | 'resign' | 'state' | 'move' | 'check'

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === 'arrow-up-right' && <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>}
      {name === 'arrow-right' && <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>}
      {name === 'match' && <><circle cx="8" cy="12" r="3" /><circle cx="16" cy="12" r="3" /><path d="M11 12h2" /></>}
      {name === 'board' && <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M4 12h16M12 4v16" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /></>}
      {name === 'tools' && <><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="m8 11 8-4M8 13l8 4" /></>}
      {name === 'close' && <><path d="m7 7 10 10M17 7 7 17" /></>}
      {name === 'pass' && <><path d="M5 9c3-3 8-3 11 0" /><path d="m14 6 3 3-3 3" /><path d="M19 15c-3 3-8 3-11 0" /><path d="m10 18-3-3 3-3" /></>}
      {name === 'resign' && <><path d="M6 21V4" /><path d="M6 5h11l-2 4 2 4H6" /></>}
      {name === 'state' && <><circle cx="7" cy="7" r="2.5" fill="currentColor" stroke="none" /><path d="M13 6h6M13 10h6M5 16h14M5 20h9" /></>}
      {name === 'move' && <><path d="M4 12h16M12 4v16" /><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></>}
      {name === 'check' && <path d="m6 12 4 4 8-9" />}
    </svg>
  )
}

function formatLastMove(point?: Point): string {
  if (!point) return '—'
  return `${String.fromCharCode(65 + point.x)}${point.y + 1}`
}

export default App

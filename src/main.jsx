import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// v4.14.0: Der Inkognito-Schalter hing hier global und lag damit auch über
// Login, Chatter- und Model-Portal. Er gehört nur ins Admin-Dashboard und wird
// jetzt dort gerendert (App.jsx, ganz unten).
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

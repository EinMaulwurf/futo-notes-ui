import {mount} from 'svelte';
import App from './App.svelte';
import './style.css';
mount(App,{target:document.getElementById('app')!});
if('serviceWorker' in navigator) navigator.serviceWorker.register('/web/sw.js',{scope:'/web/'}).catch(()=>{});

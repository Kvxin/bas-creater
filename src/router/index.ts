import { createRouter, createWebHistory } from 'vue-router'


const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/Home.vue'),
  },
  {
    path: '/editor',
    name: 'editor',
    component: () => import('@/views/Editor.vue'),
  },
  {
    path: '/test',
    name: "test",
    component: () => import('@/views/Test.vue')
  }
]



const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: routes,
})

export default router

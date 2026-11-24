def text c {
    content = "bilibili"
    fontSize = 10%
    x = 0
    y = 0
}
set c {
    x = 70%
    y = 50%
} 3s
then set c {
    x = 0
    y = 80%
} 2s

def text t1 {
    content = "bilibili1"
    fontSize = 5%
    y = 80%
}
def text t2 {
    content = "bilibili2"
    fontSize = 5%
    y = 80%
}
set t1 {
    x = 40%
} 1s
then set t2 {
    y = 20%
} 1s
then set t1 {
    x = 0
} 1s
then set t2 {
    y = 80%
} 1s

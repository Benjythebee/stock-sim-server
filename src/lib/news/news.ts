import { randomUUIDv7 } from "bun";
import type { Room } from "../room";
import type { Simulator } from "../simulator";
import { MessageType } from "../../types";
import { CONSTANT_NEWS } from "./news_constants";

export type NewsDescription= {
    title: string | ((room:Room)=>string);
    description: string| ((room:Room)=>string);
    durationTicks: number;
    onStart?: (room: Room, simulator: Simulator)=>void;
    onTick?: (room: Room, simulator: Simulator,clock:number)=>void;
    onEnd?: ()=>void;
}


export class NewsFactory{
    /**
     *  News that have already been exhausted (completed their duration)
     * We're keeping them here for potential future reference
     */
    exhaustedNews: Map<string, News> = new Map();
    /**
     * Active news items
     */
    map: Map<string, News> = new Map();

    nextRandomNewsTimeout: NodeJS.Timeout | null = null;

    constructor(public room: Room, public simulator: Simulator, randomNews?:boolean) {

        if(randomNews){
            const scheduleNextNews = () => {
                const timeoutDuration = Math.abs((30 + Math.floor(this.random()*15))) * 1000; // between 15 and 45 seconds
                this.nextRandomNewsTimeout = setTimeout(() => {
                    if(this.simulator.isPaused){
                        // If the simulator is paused, skip this news cycle
                        scheduleNextNews();
                        return;
                    }
                    const newsIndex = Math.floor(this.random() * CONSTANT_NEWS.length);
                    const newsDesc = CONSTANT_NEWS[newsIndex];
                    if(!newsDesc) {
                        console.error('No news description found for index:', newsIndex,'max index',CONSTANT_NEWS.length-1);
                        scheduleNextNews();
                        return;
                    }
                    this.addNews(newsDesc!);
                    scheduleNextNews();
                }, timeoutDuration);
            }
            scheduleNextNews();
        }
    }

    random = ()=> {
        return Math.abs(this.room.randomGenerator.nextNormal());
    }

    addNews(newsDescription: NewsDescription) {
       const news = new News(newsDescription, this);
       if(news.exhausted) {
            this.exhaustedNews.set(news.id, news);
        }else{
            this.map.set(news.id, news);
        }
        return news;
    }

    removeNews(newsId: string) {
        this.map.delete(newsId);
        this.exhaustedNews.delete(newsId);
    }


    tick=(clock:number)=> {
        for(const news of this.map.values()) {
            news.onTick(clock);
        }
    }


    dispose() { 
        this.map.clear();
        this.exhaustedNews.clear();
        this.room = null as any;
        this.simulator = null as any;
    }
}

export class News {
    id: string = randomUUIDv7();
    title: string;
    description: string;
    private durationTicks: number;

    exhausted: boolean = false;
    private ticksElapsed: number = 0;

    /**
     * Customizable callbacks that are run on top of the default behavior
     */
    onDescriptionTick?: (room: Room, simulator: Simulator,clock:number)=>void;
    onDescriptionEnd?: ()=>void;
    onDescriptionStart?: (room: Room, simulator: Simulator)=>void;

    constructor(newsDescription: NewsDescription, public factory: NewsFactory) {
        
        this.title = typeof newsDescription.title === "string" ? newsDescription.title: newsDescription.title(factory.room);
        this.description = typeof newsDescription.description === "string" ? newsDescription.description: newsDescription.description(factory.room);
        this.durationTicks = newsDescription.durationTicks;
        this.exhausted = false;
        this.ticksElapsed = 0;
        this.onDescriptionTick = newsDescription.onTick;
        this.onDescriptionStart = newsDescription.onStart;
        this.onDescriptionEnd = newsDescription.onEnd;

        this.onStart();

        if(!this.onTick || this.durationTicks <=0) {
            this.exhausted = true;
        }
    }

    get room() {
        return this.factory.room;
    }
    get simulator() {
        return this.factory.simulator;
    }

    onStart = ()=>{
        this.room.sendToAll({
            type: MessageType.NEWS,
            title: this.title,
            description: this.description,
            timestamp: Date.now(),
            durationTicks: this.durationTicks
        })
        this.onDescriptionStart?.(this.room, this.simulator);
    };

    onTick = (clock:number)=> {
        if(this.exhausted) return;
        this.ticksElapsed++;
        if(this.onDescriptionTick) {
            this.onDescriptionTick(this.room, this.simulator, clock);
        }
        if(this.ticksElapsed >= this.durationTicks) {
            this.exhausted = true;
            this.factory.exhaustedNews.set(this.id, this);
            this.factory.map.delete(this.id);
        }
    }

}